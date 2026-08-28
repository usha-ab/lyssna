"use client";

// PDF → uppläsbar text.
//
// PDF lagrar text som positionerade fragment, inte som meningar: ett stycke
// kan vara hundra bitar med varsin koordinat. Uppläsaren behöver löpande text,
// så bitarna sätts ihop till rader efter y-läge och radbrytningen avgörs av
// avståndet mellan raderna — annars blir varje rad ett eget stycke och
// segmenteringen bryter mitt i meningar.
//
// pdfjs laddas dynamiskt: det är ett stort bibliotek som bara den som faktiskt
// öppnar en PDF ska behöva hämta.

export type PdfErrorCode = "unreadable" | "no-text";

/** Som EpubError: koden är för gränssnittet att översätta. */
export class PdfError extends Error {
  constructor(readonly code: PdfErrorCode) {
    super(`pdf: ${code}`);
    this.name = "PdfError";
  }
}

/** Ett textfragment som pdfjs ger oss, nedskalat till det vi behöver. */
export interface PdfTextItem {
  text: string;
  /** Radens y-läge i sidans koordinater. */
  y: number;
  /** Fragmentets x-läge, för sortering inom raden. */
  x: number;
  height: number;
  /** pdfjs markerar själv radslut i vissa dokument. */
  eol?: boolean;
}

/**
 * Sätter ihop fragment till text. Ren funktion — hela känsligheten i
 * PDF-läsningen ligger här, och den går att testa utan pdfjs.
 */
export function assemblePageText(items: PdfTextItem[]): string {
  if (items.length === 0) return "";

  // Gruppera på rad. Två fragment hör till samma rad om deras y-läge skiljer
  // mindre än en halv radhöjd — exakt likhet duger inte, sänkta gemener och
  // upphöjda tecken ligger någon punkt fel.
  const lines: { y: number; height: number; parts: PdfTextItem[] }[] = [];
  for (const item of items) {
    if (item.text.trim() === "") continue;
    const tolerance = Math.max(item.height * 0.5, 1);
    const line = lines.find((l) => Math.abs(l.y - item.y) <= tolerance);
    if (line) {
      line.parts.push(item);
      line.height = Math.max(line.height, item.height);
    } else {
      lines.push({ y: item.y, height: item.height || 10, parts: [item] });
    }
  }

  // PDF räknar y nedifrån och upp, så fallande y är läsordning.
  lines.sort((a, b) => b.y - a.y);

  const rendered: string[] = [];
  let previous: { y: number; height: number } | null = null;
  for (const line of lines) {
    const text = line.parts
      .sort((a, b) => a.x - b.x)
      .map((p) => p.text)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;

    if (previous) {
      // Ett hopp större än en och en halv radhöjd är ett nytt stycke; annars
      // fortsätter samma stycke på nästa rad.
      const gap = previous.y - line.y;
      rendered.push(gap > line.height * 1.8 ? "\n\n" : "\n");
    }
    rendered.push(text);
    previous = { y: line.y, height: line.height || 10 };
  }

  return rendered.join("").replace(/\n{3,}/g, "\n\n").trim();
}

/** Slår ihop avstavade radslut: "fort-\nsättning" ska läsas som ett ord. */
export function joinHyphenation(text: string): string {
  return text.replace(/(\p{Ll})-\n(\p{Ll})/gu, "$1$2");
}

export interface PdfContent {
  title: string | null;
  text: string;
  pages: number;
}

/**
 * Läser ut text ur en PDF i webbläsaren.
 *
 * `onProgress` anropas per sida — en bok på 400 sidor tar tid, och utan
 * återkoppling ser gränssnittet ut att ha hängt sig.
 */
export async function parsePdf(
  data: ArrayBuffer,
  options: { maxChars?: number; onProgress?: (page: number, total: number) => void } = {}
): Promise<PdfContent> {
  const maxChars = options.maxChars ?? 500_000;

  // Legacy-bygget: standardbygget faller sönder när Next paketerar det
  // ("Object.defineProperty called on non-object"), och legacy-varianten är
  // dessutom den som kör i fler webbläsare.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.min.mjs");
  // Arbetartråden laddas som en egen fil ur paketet; utan den kör pdfjs allt
  // på huvudtråden och gränssnittet fryser under uppslagningen.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  let document;
  try {
    document = await pdfjs.getDocument({ data }).promise;
  } catch {
    throw new PdfError("unreadable");
  }

  const pageCount = document.numPages;
  let title: string | null = null;
  const pages: string[] = [];
  let total = 0;
  try {
    try {
      const metadata = await document.getMetadata();
      const info = metadata.info as { Title?: unknown } | undefined;
      if (typeof info?.Title === "string" && info.Title.trim()) title = info.Title.trim();
    } catch {
      // Titel saknas eller är trasig — filnamnet får duga i stället.
    }

    for (let number = 1; number <= pageCount; number++) {
      if (total >= maxChars) break;
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        items.push({
          text: item.str,
          x: item.transform[4],
          y: item.transform[5],
          height: Math.abs(item.transform[3]) || item.height || 10,
          eol: item.hasEOL,
        });
      }
      page.cleanup();
      const text = joinHyphenation(assemblePageText(items));
      if (text) {
        pages.push(text);
        total += text.length + 2;
      }
      options.onProgress?.(number, pageCount);
    }
  } finally {
    await document.destroy();
  }

  const text = pages.join("\n\n").slice(0, maxChars);
  if (text.trim().length < 20) {
    // Inskannade sidor är bilder utan textlager. Det kräver OCR, vilket är
    // något annat än att läsa en PDF.
    throw new PdfError("no-text");
  }
  return { title, text, pages: pageCount };
}
