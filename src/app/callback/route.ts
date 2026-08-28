// Växlar in koden från ett inloggningsmejl eller en OAuth-runda mot en session.

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const origin = request.nextUrl.origin;

  if (!code) return NextResponse.redirect(`${origin}/login?fel=1`);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login?fel=1`);

  return NextResponse.redirect(origin);
}
