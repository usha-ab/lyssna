// Bibliotekets serverdel: listan och uppladdning av ett dokument.
//
// Listan bär avsiktligt INTE med texterna. Ett bibliotek på fyrtio dokument
// kan vara många megabyte, och det mesta av det behövs aldrig — texten hämtas
// per dokument när det öppnas ([id]/route.ts).

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { rateLimit } from "@/lib/rate-limit";
import { MAX_DOCUMENT_CHARS, type DocumentSource } from "@/lib/tts/library";

export const dynamic = "force-dynamic";

const SOURCES: DocumentSource[] = ["paste", "file", "url", "pdf", "epub"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { supabase, user } = auth;

  const { data, error } = await supabase
    .from("listen_documents")
    .select("id, title, source, source_url, progress, created_at, updated_at, content_length")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Biblioteket gick inte att hämta." }, { status: 500 });
  }

  return NextResponse.json({ documents: data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { supabase, user } = auth;

  const limited = rateLimit(`upload:${user.id}`, 60, 60_000);
  if (!limited.allowed) {
    return NextResponse.json({ error: "För många sparningar. Vänta en stund." }, { status: 429 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Ogiltig förfrågan." }, { status: 400 });
  }

  const body = payload as Record<string, unknown>;
  const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  const content = typeof body.content === "string" ? body.content : "";
  const source = SOURCES.includes(body.source as DocumentSource)
    ? (body.source as DocumentSource)
    : "paste";
  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.slice(0, 2048) : null;
  const progress = Number.isFinite(body.progress) ? Math.max(0, Math.round(body.progress as number)) : 0;
  const updatedAt =
    typeof body.updatedAt === "number" && Number.isFinite(body.updatedAt)
      ? new Date(body.updatedAt)
      : new Date();
  const createdAt =
    typeof body.createdAt === "number" && Number.isFinite(body.createdAt)
      ? new Date(body.createdAt)
      : updatedAt;

  if (!id) return NextResponse.json({ error: "Ogiltigt dokument-id." }, { status: 400 });
  if (!title || content.length === 0) {
    return NextResponse.json({ error: "Dokumentet saknar titel eller text." }, { status: 400 });
  }
  if (content.length > MAX_DOCUMENT_CHARS) {
    return NextResponse.json({ error: "Texten är för lång." }, { status: 413 });
  }

  // user_id sätts från sessionen, aldrig från anropet: annars kunde en
  // inloggad användare skriva rader åt någon annan. RLS skulle stoppa det,
  // men grinden ska inte sitta bara på ett ställe.
  const { error } = await supabase.from("listen_documents").upsert(
    {
      id,
      user_id: user.id,
      title,
      content,
      source,
      source_url: sourceUrl,
      progress: Math.min(progress, content.length),
      created_at: createdAt.toISOString(),
      updated_at: updatedAt.toISOString(),
    },
    { onConflict: "id" }
  );

  if (error) {
    return NextResponse.json({ error: "Dokumentet gick inte att spara." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
