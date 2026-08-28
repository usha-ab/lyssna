// Ett enskilt dokument: hämta texten, spara läspositionen, radera.

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Ogiltigt id." }, { status: 400 });

  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const { data, error } = await auth.supabase
    .from("listen_documents")
    .select("id, title, content, source, source_url, progress, created_at, updated_at")
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Dokumentet gick inte att hämta." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Dokumentet finns inte." }, { status: 404 });

  return NextResponse.json({ document: data });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Ogiltigt id." }, { status: 400 });

  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Ogiltig förfrågan." }, { status: 400 });
  }

  const body = payload as Record<string, unknown>;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (Number.isFinite(body.progress)) {
    patch.progress = Math.max(0, Math.round(body.progress as number));
  }
  if (typeof body.title === "string" && body.title.trim()) {
    patch.title = body.title.trim().slice(0, 120);
  }
  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: "Inget att uppdatera." }, { status: 400 });
  }

  const { error } = await auth.supabase
    .from("listen_documents")
    .update(patch)
    .eq("id", id)
    .eq("user_id", auth.user.id);

  if (error) return NextResponse.json({ error: "Uppdateringen gick inte igenom." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Ogiltigt id." }, { status: 400 });

  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const { error } = await auth.supabase
    .from("listen_documents")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.user.id);

  if (error) return NextResponse.json({ error: "Dokumentet gick inte att ta bort." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
