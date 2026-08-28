// HTML → uppläsbar text.
//
// Importerade artiklar ska låta som artiklar, inte som cookiebanners och
// menyrader. Vi plockar därför bort de element som aldrig ska läsas upp,
// föredrar <article> när sidan har en, och behåller styckesgränser eftersom
// segmenteringen använder radbrytningar för att bryta meningar.

/** Element vars innehåll aldrig ska läsas upp. */
const DROPPED_TAGS = [
  "script", "style", "noscript", "template", "svg", "canvas", "iframe",
  "nav", "header", "footer", "aside", "form", "button", "select",
];

/** Element som avslutar ett stycke — utan dem klistras rubriker ihop med brödtext. */
const BLOCK_TAGS = [
  "p", "div", "section", "article", "br", "li", "tr", "blockquote", "pre",
  "h1", "h2", "h3", "h4", "h5", "h6",
];

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  aring: "å", auml: "ä", ouml: "ö", Aring: "Å", Auml: "Ä", Ouml: "Ö",
  eacute: "é", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘",
  ldquo: "”", rdquo: "”", laquo: "«", raquo: "»", middot: "·", bull: "•",
  copy: "©", reg: "®", trade: "™", deg: "°", euro: "€", pound: "£",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      // Ogiltiga och kontrolltecken lämnas som de är hellre än att bli skräp.
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

/** Sidans titel, om den har en. */
export function extractTitle(html: string): string | null {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (og) return decodeEntities(og[1]).trim() || null;
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) {
    const text = decodeEntities(h1[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) return decodeEntities(title[1]).replace(/\s+/g, " ").trim() || null;
  return null;
}

/** Artikelkroppen om sidan märkt ut en, annars hela body. */
function mainContent(html: string): string {
  const article = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (article && article[1].length > 500) return article[1];
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (main && main[1].length > 500) return main[1];
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return body ? body[1] : html;
}

/** Plockar ut läsbar brödtext ur HTML. */
export function htmlToText(html: string): string {
  let text = mainContent(html);

  // Kommentarer först: de kan innehålla taggar som annars förvirrar resten.
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  for (const tag of DROPPED_TAGS) {
    text = text.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
    // Självstängande eller ostängda varianter av samma taggar.
    text = text.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi"), " ");
  }
  for (const tag of BLOCK_TAGS) {
    text = text.replace(new RegExp(`</?${tag}\\b[^>]*>`, "gi"), "\n");
  }
  text = text.replace(/<[^>]+>/g, " ");
  text = decodeEntities(text);

  return text
    .replace(/\r/g, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
