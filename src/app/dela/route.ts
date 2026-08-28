// Delningsmålet: appen i Androids dela-meny.
//
// Poängen är att slippa kopiera. Markerar man text någonstans — i en chatt,
// ett mejl, en artikel — och trycker Dela → Lyssna, hamnar den här. Texten
// sparas direkt på kontot och läsvyn öppnas på den.
//
// Android skickar delningen som POST med formulärdata (se share_target i
// manifestet). Vissa appar delar i stället bara en länk, och då finns ingen
// text att spara: då skickas adressen vidare till importflödet i vyn, som
// hämtar artikeln på samma sätt som när man klistrar in en länk själv.

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { MAX_DOCUMENT_CHARS } from "@/lib/tts/library";
import { titleFromText } from "@/lib/tts/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Shared {
  title: string | null;
  text: string | null;
  url: string | null;
}

/** Plockar ut de tre fälten oavsett om delningen kom som formulär eller query. */
async function readShare(request: NextRequest): Promise<Shared> {
  const pick = (value: FormDataEntryValue | string | null) =>
    typeof value === "string" && value.trim() ? value.trim() : null;

  if (request.method === "POST") {
    try {
      const form = await request.formData();
      return {
        title: pick(form.get("title")),
        text: pick(form.get("text")),
        url: pick(form.get("url")),
      };
    } catch {
      return { title: null, text: null, url: null };
    }
  }

  const params = request.nextUrl.searchParams;
  return {
    title: pick(params.get("title")),
    text: pick(params.get("text")),
    url: pick(params.get("url")),
  };
}

/**
 * En delad text är ibland bara en länk — appar lägger då adressen i text-
 * fältet i stället för i url-fältet. Den ska importeras som artikel, inte
 * läsas upp som en rad.
 */
function asUrl(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/\s/.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

async function handle(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const auth = await requireUser();
  // Inte inloggad eller utan tillgång: skicka till inloggningen i stället för
  // att svara med JSON som ingen ser — det här är ett flöde i gränssnittet.
  if ("error" in auth) {
    return NextResponse.redirect(`${origin}/login`, { status: 303 });
  }

  const shared = await readShare(request);
  const link = shared.url ?? asUrl(shared.text);
  const text = shared.text && !asUrl(shared.text) ? shared.text : null;

  if (!text && link) {
    return NextResponse.redirect(
      `${origin}/?importera=${encodeURIComponent(link)}`,
      { status: 303 }
    );
  }

  if (!text) {
    return NextResponse.redirect(`${origin}/?delning=tom`, { status: 303 });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const content = text.slice(0, MAX_DOCUMENT_CHARS);
  const { error } = await auth.supabase.from("listen_documents").insert({
    id,
    user_id: auth.user.id,
    title: (shared.title ?? titleFromText(content, "Delad text")).slice(0, 120),
    content,
    source: "paste",
    source_url: link,
    progress: 0,
    created_at: now,
    updated_at: now,
  });

  if (error) {
    return NextResponse.redirect(`${origin}/?delning=fel`, { status: 303 });
  }

  // 303 så att webbläsaren gör om POST:en till en GET — annars ligger
  // delningen kvar i historiken och görs om vid varje bakåtknapp.
  return NextResponse.redirect(`${origin}/?oppna=${id}`, { status: 303 });
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
