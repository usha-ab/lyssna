import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canUseApp } from "@/lib/access";
import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Logga in – Lyssna" };

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Redan inloggad och behörig: ingen anledning att visa formuläret igen.
  if (user && (await canUseApp(user.id))) redirect("/");

  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
