// Vem som får använda appen.
//
// Uppläsaren delar konto och databas med Usha Platform, men är avsiktligt inte
// öppen för varje plattformskonto som hittar hit. LISTEN_ALLOWED_USER_IDS
// avgör: en lista med user-id, eller "*" för att öppna för alla inloggade.
// Utan variabeln är appen låst till fulla admins.

import { createClient } from "@supabase/supabase-js";

export function parseAllowedIds(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return Array.from(
    new Set(
      raw
        .split(/[,\s]+/)
        .map((id) => id.trim().toLowerCase())
        .filter((id) => uuid.test(id))
    )
  );
}

export function isOpenToEveryone(raw: string | undefined | null): boolean {
  return (raw ?? "").trim() === "*";
}

export function isAllowedById(userId: string | null | undefined, allowed: string[]): boolean {
  if (!userId) return false;
  return allowed.includes(userId.toLowerCase());
}

/** Slår upp is_admin med service-role — profiles-raden tillhör någon annan än den som frågar. */
async function isAdmin(userId: string): Promise<boolean> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return false;
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data } = await admin.from("profiles").select("is_admin").eq("id", userId).single();
  return data?.is_admin === true;
}

export async function canUseApp(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const raw = process.env.LISTEN_ALLOWED_USER_IDS;
  if (isOpenToEveryone(raw)) return true;
  if (isAllowedById(userId, parseAllowedIds(raw))) return true;
  return isAdmin(userId);
}
