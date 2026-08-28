import { describe, it, expect } from "vitest";
import { parseEpub, spineHrefs, opfTitle, resolvePath, EpubError } from "../epub";

// En riktig EPUB är en ZIP. För att slippa en binär testfil byggs arkivet här,
// med både lagrade och deflate-komprimerade poster — båda vägarna genom
// läsaren ska täckas.
async function zip(files: { name: string; content: string; deflate?: boolean }[]): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const raw = encoder.encode(file.content);
    let data = raw;
    if (file.deflate) {
      const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    }

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, file.deflate ? 8 : 0, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, file.deflate ? 8 : 0, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, at);
    at += part.length;
  }
  return out.buffer;
}

const CONTAINER = `<?xml version="1.0"?>
<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;

const OPF = `<?xml version="1.0"?>
<package><metadata><dc:title>Boken om något</dc:title></metadata>
<manifest>
  <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml"/>
  <item id="ch2" href="text/chapter2.xhtml" media-type="application/xhtml+xml"/>
  <item id="ch10" href="text/chapter10.xhtml" media-type="application/xhtml+xml"/>
  <item id="cover" href="cover.jpg" media-type="image/jpeg"/>
</manifest>
<spine><itemref idref="ch2"/><itemref idref="ch10"/><itemref idref="cover"/></spine>
</package>`;

async function sampleBook() {
  return zip([
    { name: "META-INF/container.xml", content: CONTAINER },
    { name: "OEBPS/content.opf", content: OPF },
    { name: "OEBPS/text/chapter2.xhtml", content: "<html><body><h1>Kapitel 2</h1><p>Första stycket.</p></body></html>", deflate: true },
    { name: "OEBPS/text/chapter10.xhtml", content: "<html><body><p>Sista kapitlet.</p></body></html>" },
  ]);
}

describe("parseEpub", () => {
  it("läser titel och text i spine-ordning", async () => {
    const book = await parseEpub(await sampleBook());
    expect(book.title).toBe("Boken om något");
    expect(book.text).toBe("Kapitel 2\n\nFörsta stycket.\n\nSista kapitlet.");
  });

  it("klarar både lagrade och komprimerade filer i samma arkiv", async () => {
    const book = await parseEpub(await sampleBook());
    // chapter2 är deflate-komprimerad, chapter10 lagrad.
    expect(book.text).toContain("Första stycket.");
    expect(book.text).toContain("Sista kapitlet.");
  });

  it("kortar boken vid taket", async () => {
    const book = await parseEpub(await sampleBook(), 12);
    expect(book.text).toHaveLength(12);
  });

  it("avvisar något som inte är ett arkiv", async () => {
    const notZip = new TextEncoder().encode("bara text, inget arkiv").buffer;
    await expect(parseEpub(notZip)).rejects.toBeInstanceOf(EpubError);
  });

  it("avvisar ett arkiv utan innehållsförteckning", async () => {
    const archive = await zip([{ name: "random.txt", content: "hej" }]);
    await expect(parseEpub(archive)).rejects.toMatchObject({ code: "no-container" });
  });

  it("avvisar en bok utan läsbar text", async () => {
    const archive = await zip([
      { name: "META-INF/container.xml", content: CONTAINER },
      { name: "OEBPS/content.opf", content: "<package><manifest></manifest><spine></spine></package>" },
    ]);
    await expect(parseEpub(archive)).rejects.toMatchObject({ code: "no-text" });
  });
});

describe("spineHrefs", () => {
  it("följer spine-ordningen, inte manifestets", () => {
    expect(spineHrefs(OPF, "OEBPS/content.opf")).toEqual([
      "OEBPS/text/chapter2.xhtml",
      "OEBPS/text/chapter10.xhtml",
    ]);
  });

  it("hoppar över det som inte är text", () => {
    expect(spineHrefs(OPF, "OEBPS/content.opf")).not.toContain("OEBPS/cover.jpg");
  });

  it("ignorerar itemref utan motsvarande item", () => {
    const opf = `<manifest></manifest><spine><itemref idref="saknas"/></spine>`;
    expect(spineHrefs(opf, "content.opf")).toEqual([]);
  });
});

describe("resolvePath", () => {
  it("löser upp relativa sökvägar", () => {
    expect(resolvePath("OEBPS/content.opf", "text/kap.xhtml")).toBe("OEBPS/text/kap.xhtml");
    expect(resolvePath("OEBPS/sub/content.opf", "../text/kap.xhtml")).toBe("OEBPS/text/kap.xhtml");
  });

  it("släpper ankare och avkodar procenttecken", () => {
    expect(resolvePath("a/b.opf", "kap%201.xhtml#start")).toBe("a/kap 1.xhtml");
  });
});

describe("opfTitle", () => {
  it("ger null när titel saknas", () => {
    expect(opfTitle("<package></package>")).toBeNull();
  });
});
