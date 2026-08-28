import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canUseApp } from "@/lib/access";
import { ListenApp } from "@/components/listen-app";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!(await canUseApp(user.id))) redirect("/login?nekad=1");

  return <ListenApp />;
}
