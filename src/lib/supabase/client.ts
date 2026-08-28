import { createBrowserClient } from "@supabase/ssr";

function makeClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// En instans delad av alla klientkomponenter. Flera klienter betyder flera
// samtidiga token-uppdaterare som tävlar med varandra, och med roterande
// refresh-tokens gör en förlorad tävling sessionen ogiltig.
let browserClient: ReturnType<typeof makeClient> | undefined;

export function createClient() {
  return (browserClient ??= makeClient());
}
