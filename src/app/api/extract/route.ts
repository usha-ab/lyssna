// Importerar en artikel till uppläsaren.
//
// Hämtningen måste ske på servern — webbläsaren stoppas av CORS på i stort
// sett varje sajt. Att servern hämtar en adress som användaren skriver in är
// samtidigt precis vad SSRF är, så varje adress passerar url-guard före
// hämtningen, varje omdirigering kontrolleras om, och DNS-svaret kontrolleras
// innan svaret läses: ett publikt värdnamn kan peka på 10.0.0.1.

import { NextRequest, NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { requireUser } from "@/lib/api-auth";
import { rateLimit } from "@/lib/rate-limit";
import { checkUrl, isPrivateAddress, type UrlRejection } from "@/lib/tts/url-guard";
import { htmlToText, extractTitle } from "@/lib/tts/html-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Så mycket av svaret vi läser. Räcker för långa artiklar, stoppar nedladdningar. */
const MAX_BYTES = 3 * 1024 * 1024;
/** Taket på den uppläsbara texten — samma som bibliotekets dokumenttak. */
const MAX_CHARS = 500_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

const REJECTION_MESSAGE: Record<UrlRejection, string> = {
  invalid: "Det där ser inte ut som en webbadress.",
  protocol: "Bara http- och https-adresser kan importeras.",
  private: "Den adressen går inte att hämta.",
  credentials: "Adresser med inloggningsuppgifter kan inte importeras.",
  port: "Den adressen går inte att hämta.",
};

/** Pekar värdnamnet på en adress vi inte får hämta? */
async function resolvesToPrivateAddress(hostname: string): Promise<boolean> {
  try {
    const records = await lookup(hostname, { all: true });
    // Inga svar betyder inget att hämta — behandla som blockerat.
    if (records.length === 0) return true;
    return records.some((r) => isPrivateAddress(r.address));
  } catch {
    return true;
  }
}

/** Hämtar sidan och följer omdirigeringar själv, med samma grind på varje hopp. */
async function fetchPage(
  start: URL,
  signal: AbortSignal
): Promise<{ response: Response; url: URL } | { error: "blocked" | "failed" }> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (await resolvesToPrivateAddress(url.hostname)) return { error: "blocked" };

    let response: Response;
    try {
      response = await fetch(url, {
        signal,
        redirect: "manual",
        headers: {
          // Utan en riktig user-agent svarar många sajter med en tom sida.
          "user-agent": "Mozilla/5.0 (compatible; UshaLyssna/1.0; +https://usha.se)",
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
          "accept-language": "sv,en;q=0.8",
        },
      });
    } catch {
      return { error: "failed" };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { error: "failed" };
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        return { error: "failed" };
      }
      const checked = checkUrl(next.toString());
      if (!checked.ok) return { error: "blocked" };
      url = checked.url;
      continue;
    }

    return { response, url };
  }
  return { error: "failed" };
}

/** Läser svaret upp till takgränsen i stället för att lita på content-length. */
async function readCapped(response: Response): Promise<string> {
  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const room = MAX_BYTES - size;
      if (value.byteLength >= room) {
        chunks.push(value.subarray(0, room));
        size = MAX_BYTES;
        break;
      }
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const limited = rateLimit(`extract:${auth.user.id}`, 10, 60_000);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "För många importer. Vänta en minut och försök igen." },
      { status: 429 }
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Ogiltig förfrågan." }, { status: 400 });
  }
  const raw = (payload as { url?: unknown })?.url;
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) {
    return NextResponse.json({ error: REJECTION_MESSAGE.invalid }, { status: 400 });
  }

  const checked = checkUrl(raw);
  if (!checked.ok) {
    return NextResponse.json({ error: REJECTION_MESSAGE[checked.reason] }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const result = await fetchPage(checked.url, controller.signal);
    if ("error" in result) {
      return NextResponse.json(
        {
          error:
            result.error === "blocked"
              ? REJECTION_MESSAGE.private
              : "Sidan gick inte att hämta. Kontrollera adressen och försök igen.",
        },
        { status: result.error === "blocked" ? 400 : 502 }
      );
    }

    const { response, url } = result;
    if (!response.ok) {
      return NextResponse.json(
        { error: `Sidan svarade med fel (${response.status}).` },
        { status: 502 }
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!/^\s*(text\/html|application\/xhtml\+xml|text\/plain)/i.test(contentType)) {
      return NextResponse.json(
        { error: "Adressen pekar inte på en läsbar sida." },
        { status: 415 }
      );
    }

    const body = await readCapped(response);
    const isPlain = /^\s*text\/plain/i.test(contentType);
    const text = (isPlain ? body.trim() : htmlToText(body)).slice(0, MAX_CHARS);

    if (text.length < 40) {
      return NextResponse.json(
        { error: "Hittade ingen läsbar text på sidan." },
        { status: 422 }
      );
    }

    const title = (isPlain ? null : extractTitle(body)) ?? url.hostname;
    return NextResponse.json({ title: title.slice(0, 120), text, url: url.toString() });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return NextResponse.json(
      { error: aborted ? "Sidan svarade för långsamt." : "Sidan gick inte att hämta." },
      { status: 504 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
