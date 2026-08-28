// Textsegmentering för uppläsning.
//
// Uppläsaren talar en mening i taget i stället för hela dokumentet i en enda
// utterance. Skälet är tre: Chrome klipper långa utterances, boundary-events
// blir opålitliga efter några tusen tecken, och utan meningsgränser går det
// inte att hoppa en mening bakåt eller markera var läsningen är.
//
// Varje segment bär sina teckenpositioner i originaltexten, så att markeringen
// i läsvyn och sparad läsposition kan uttryckas i originalets koordinater.

export interface Segment {
  /** Segmentets ordning i dokumentet. */
  index: number;
  /** Startposition i originaltexten (inklusive). */
  start: number;
  /** Slutposition i originaltexten (exklusive). */
  end: number;
  /** Texten som ska läsas upp — originalets utsnitt, trimmat. */
  text: string;
}

/**
 * Längsta segment vi skickar till talsyntesen. Ligger under gränsen där
 * Chrome börjar tappa boundary-events, men tillräckligt långt för att en
 * normal mening ska hållas ihop och få rätt satsmelodi.
 */
const MAX_SEGMENT_CHARS = 280;

/**
 * Förkortningar där punkten inte avslutar en mening. Svenska först — det är
 * appens språk — följt av de engelska som ändå dyker upp i inklistrad text.
 * Jämförs gemenbokstavsokänsligt mot ordet före punkten, utan punkter i sig
 * ("t.ex" matchas som "tex").
 */
const ABBREVIATIONS = new Set([
  "tex", "bla", "dvs", "osv", "mm", "fom", "tom", "sk", "ca", "kl", "nr",
  "resp", "jfr", "ang", "fd", "st", "dr", "prof", "inkl", "exkl", "obs",
  "etc", "eg", "ie", "vs", "mr", "mrs", "ms", "no", "fig",
]);

const SENTENCE_ENDINGS = new Set([".", "!", "?", "…"]);
/** Tecken som får följa efter punkten och ändå tillhöra samma mening. */
const CLOSING_CHARS = new Set(['"', "'", "”", "’", ")", "]", "»", "]"]);

function isWhitespace(ch: string): boolean {
  return /\s/.test(ch);
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

/** Ordet omedelbart före positionen, utan punkter och gemener. */
function wordBefore(text: string, pos: number): string {
  let i = pos;
  while (i > 0 && /[^\s]/.test(text[i - 1])) i--;
  return text.slice(i, pos).replace(/\./g, "").toLowerCase();
}

/** Avslutar punkten vid `i` faktiskt en mening? */
function endsSentence(text: string, i: number): boolean {
  const ch = text[i];
  if (!SENTENCE_ENDINGS.has(ch)) return false;

  // Decimaltal och datum: 3.14, 2024.01 — punkten binder ihop, inte isär.
  if (ch === "." && isDigit(text[i - 1] ?? "") && isDigit(text[i + 1] ?? "")) {
    return false;
  }

  if (ch === ".") {
    const word = wordBefore(text, i);
    if (ABBREVIATIONS.has(word)) return false;
    // Initialer: "A. Andersson" är ett namn, inte två meningar.
    if (word.length === 1 && /[a-zà-öø-ÿ]/i.test(word)) return false;
  }

  // Hoppa över citattecken och paranteser som stänger efter punkten.
  let j = i + 1;
  while (j < text.length && CLOSING_CHARS.has(text[j])) j++;
  // Flera avslutningstecken i rad ("?!", "...") räknas som ett slut.
  while (j < text.length && SENTENCE_ENDINGS.has(text[j])) j++;

  if (j >= text.length) return true;
  return isWhitespace(text[j]);
}

/** Positionen där ett för långt segment helst bryts: efter komma, annars mellanslag. */
function softBreak(text: string, from: number, limit: number): number {
  const window = text.slice(from, limit);
  for (const pattern of [/[,;:—–][^\S\n]/g, /\s/g]) {
    let best = -1;
    let m: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((m = pattern.exec(window)) !== null) {
      // Bryt inte så tidigt att biten blir en handfull tecken.
      if (m.index > window.length * 0.3) best = m.index + m[0].length;
    }
    if (best > 0) return from + best;
  }
  return limit;
}

/** Trimmar bort omgivande blanktecken och lägger till segmentet om något blev kvar. */
function pushSegment(out: Segment[], text: string, start: number, end: number): void {
  let s = start;
  let e = end;
  while (s < e && isWhitespace(text[s])) s++;
  while (e > s && isWhitespace(text[e - 1])) e--;
  if (e <= s) return;
  out.push({ index: out.length, start: s, end: e, text: text.slice(s, e) });
}

/** Delar ett stycke i meningar, och långa meningar i talbara bitar. */
function splitRange(out: Segment[], text: string, from: number, to: number): void {
  let start = from;
  for (let i = from; i < to; i++) {
    if (!endsSentence(text, i)) continue;
    let end = i + 1;
    while (end < to && (CLOSING_CHARS.has(text[end]) || SENTENCE_ENDINGS.has(text[end]))) end++;
    pushSegmentChunked(out, text, start, end);
    start = end;
  }
  pushSegmentChunked(out, text, start, to);
}

/** Som pushSegment, men delar bitar som är för långa för talsyntesen. */
function pushSegmentChunked(out: Segment[], text: string, start: number, end: number): void {
  let s = start;
  while (end - s > MAX_SEGMENT_CHARS) {
    const cut = softBreak(text, s, s + MAX_SEGMENT_CHARS);
    pushSegment(out, text, s, cut);
    s = cut;
  }
  pushSegment(out, text, s, end);
}

/**
 * Delar text i uppläsningsbara segment. Radbrytningar bryter alltid — en
 * rubrik eller punktlista saknar ofta punkt, och utan brytning skulle den
 * klistras ihop med nästa stycke till en enda lång mening.
 */
export function splitSentences(text: string): Segment[] {
  const out: Segment[] = [];
  let lineStart = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === "\n") {
      splitRange(out, text, lineStart, i);
      lineStart = i + 1;
    }
  }
  return out;
}

/** Segmentet som täcker en teckenposition — för att återuppta där man slutade. */
export function segmentAtOffset(segments: Segment[], offset: number): number {
  if (segments.length === 0) return 0;
  for (let i = 0; i < segments.length; i++) {
    if (offset < segments[i].end) return i;
  }
  return segments.length - 1;
}

/** Ordet runt en position — talsyntesen ger oss startindex, vyn behöver hela ordet. */
export function wordAt(text: string, index: number): { start: number; end: number } {
  if (index < 0 || index >= text.length) return { start: 0, end: 0 };
  const isWord = (ch: string) => /[\p{L}\p{N}'’-]/u.test(ch);
  if (!isWord(text[index])) return { start: index, end: index + 1 };
  let start = index;
  let end = index;
  while (start > 0 && isWord(text[start - 1])) start--;
  while (end < text.length && isWord(text[end])) end++;
  return { start, end };
}

export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}]+(?:[''-][\p{L}\p{N}]+)*/gu);
  return matches ? matches.length : 0;
}

/**
 * Uppskattad uppläsningstid i sekunder. 150 ord/minut är ungefär vad en
 * systemröst hinner i normaltempo; hastigheten skalar linjärt.
 */
export function estimateSeconds(wordCount: number, rate = 1): number {
  if (wordCount <= 0 || rate <= 0) return 0;
  return Math.round((wordCount / 150) * 60 / rate);
}

/** mm:ss, eller h:mm:ss för långa dokument. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
