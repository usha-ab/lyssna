// EPUB → uppläsbar text.
//
// En EPUB är en ZIP med XHTML-filer och en OPF-fil som säger i vilken ordning
// de ska läsas. Något zip-bibliotek behövs inte: `DecompressionStream` finns
// i webbläsaren och avkomprimerar deflate åt oss. Det håller nere bundlen och
// gör att inget tredjepartsberoende behöver granskas för att öppna en bok.
//
// Kapitlen läses i spine-ordning, inte i filordning — en EPUB där filerna
// heter chapter10 före chapter2 ska ändå läsas i rätt ordning.

import { htmlToText, decodeEntities } from "./html-text";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export type EpubErrorCode =
  | "not-an-archive"
  | "no-container"
  | "no-content-file"
  | "unsupported-compression"
  | "no-text";

/** Felen bär en kod, inte en text: gränssnittet översätter, biblioteket inte. */
export class EpubError extends Error {
  constructor(readonly code: EpubErrorCode) {
    super(`epub: ${code}`);
    this.name = "EpubError";
  }
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

/** Filerna i arkivet, uppslagna på namn. */
function readCentralDirectory(view: DataView): Map<string, ZipEntry> {
  // Slutposten ligger sist, men kan följas av en kommentar på upp till 64 kB.
  let eocd = -1;
  const from = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= from; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new EpubError("not-an-archive");

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = new Map<string, ZipEntry>();
  const decoder = new TextDecoder("utf-8");

  for (let i = 0; i < count; i++) {
    if (offset + 46 > view.byteLength) break;
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(
      new Uint8Array(view.buffer, view.byteOffset + offset + 46, nameLength)
    );
    entries.set(name, { name, method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  if (entries.size === 0) throw new EpubError("not-an-archive");
  return entries;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(
    new DecompressionStream("deflate-raw")
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Innehållet i en fil i arkivet, som text. */
async function readFile(
  view: DataView,
  entries: Map<string, ZipEntry>,
  name: string
): Promise<string | null> {
  const entry = entries.get(name);
  if (!entry) return null;

  const header = entry.localOffset;
  if (header + 30 > view.byteLength) return null;
  if (view.getUint32(header, true) !== LOCAL_SIGNATURE) return null;
  // Den lokala huvudet har egna längder för namn och extrafält — de kan skilja
  // sig från centralkatalogens, så de måste läsas här.
  const nameLength = view.getUint16(header + 26, true);
  const extraLength = view.getUint16(header + 28, true);
  const start = header + 30 + nameLength + extraLength;
  const data = new Uint8Array(
    view.buffer,
    view.byteOffset + start,
    Math.min(entry.compressedSize, view.byteLength - start)
  );

  const bytes =
    entry.method === 0 ? data : entry.method === 8 ? await inflate(data) : null;
  if (!bytes) throw new EpubError("unsupported-compression");
  return new TextDecoder("utf-8").decode(bytes);
}

/** Slår ihop en sökväg relativt OPF-filens katalog, och normaliserar "../". */
export function resolvePath(base: string, href: string): string {
  const target = decodeURIComponent(href.split("#")[0]);
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match ? match[1] : null;
}

/** Kapitlens filnamn i läsordning, ur OPF-filen. */
export function spineHrefs(opf: string, opfPath: string): string[] {
  const manifest = new Map<string, { href: string; type: string }>();
  for (const tag of opf.match(/<item\b[^>]*>/gi) ?? []) {
    const id = attribute(tag, "id");
    const href = attribute(tag, "href");
    if (!id || !href) continue;
    manifest.set(id, { href, type: attribute(tag, "media-type") ?? "" });
  }

  const hrefs: string[] = [];
  for (const tag of opf.match(/<itemref\b[^>]*>/gi) ?? []) {
    const idref = attribute(tag, "idref");
    if (!idref) continue;
    const item = manifest.get(idref);
    if (!item) continue;
    // Navigationsfiler och omslag är inte text att läsa upp.
    if (item.type && !/x?html/i.test(item.type)) continue;
    hrefs.push(resolvePath(opfPath, item.href));
  }
  return hrefs;
}

export function opfTitle(opf: string): string | null {
  const match = opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
  if (!match) return null;
  return decodeEntities(match[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() || null;
}

export interface EpubContent {
  title: string | null;
  text: string;
}

/** Läser ut bokens titel och brödtext i läsordning. */
export async function parseEpub(buffer: ArrayBuffer, maxChars = 500_000): Promise<EpubContent> {
  const view = new DataView(buffer);
  const entries = readCentralDirectory(view);

  const container = await readFile(view, entries, "META-INF/container.xml");
  if (!container) throw new EpubError("no-container");
  const opfPath = attribute(container.match(/<rootfile\b[^>]*>/i)?.[0] ?? "", "full-path");
  if (!opfPath) throw new EpubError("no-content-file");

  const opf = await readFile(view, entries, opfPath);
  if (!opf) throw new EpubError("no-content-file");

  const chapters: string[] = [];
  let total = 0;
  for (const href of spineHrefs(opf, opfPath)) {
    if (total >= maxChars) break;
    const html = await readFile(view, entries, href);
    if (!html) continue;
    const text = htmlToText(html);
    if (!text) continue;
    chapters.push(text);
    total += text.length + 2;
  }

  const text = chapters.join("\n\n").slice(0, maxChars);
  if (text.length === 0) throw new EpubError("no-text");
  return { title: opfTitle(opf), text };
}
