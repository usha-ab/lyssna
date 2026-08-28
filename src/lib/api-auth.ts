import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canUseApp } from "@/lib/access";

/** Sessionens användare, eller ett färdigt felsvar att returnera direkt. */
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Du måste vara inloggad." }, { status: 401 }) };
  }
  if (!(await canUseApp(user.id))) {
    return {
      error: NextResponse.json({ error: "Kontot har inte tillgång." }, { status: 403 }),
    };
  }
  return { supabase, user };
}
