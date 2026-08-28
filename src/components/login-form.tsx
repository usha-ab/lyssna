"use client";

// Inloggning mot samma konto som Usha Platform: appen delar databas, så det
// finns inget separat konto att skapa här. Därför inget registreringsflöde —
// bara inloggning, och en länk till plattformen för den som saknar konto.

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Headphones, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("nekad")
      ? "Det kontot har inte tillgång till Lyssna."
      : params.get("fel")
        ? "Inloggningslänken gick inte att lösa in. Försök igen."
        : null
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    // Ett trasigt nät kastar i stället för att svara med ett fel. Utan den här
    // fångsten snurrar knappen vidare och sidan ser hängd ut.
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        setError("Fel e-post eller lösenord.");
        setBusy(false);
        return;
      }
    } catch {
      setError("Kunde inte nå inloggningen. Kontrollera nätet och försök igen.");
      setBusy(false);
      return;
    }
    // refresh() i stället för push(): sidan bakom är serverrenderad och måste
    // hämtas om med den nya sessionen, annars möts man av inloggningen igen.
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <div className="mb-8 flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--usha-gold)]/10 text-[var(--usha-gold)]">
          <Headphones size={24} />
        </span>
        <div>
          <h1 className="text-2xl font-bold">Lyssna</h1>
          <p className="text-sm text-[var(--usha-muted)]">Logga in med ditt Usha-konto.</p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-post"
          className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-3 text-sm outline-none focus:border-[var(--usha-gold)]"
        />
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Lösenord"
          className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-3 text-sm outline-none focus:border-[var(--usha-gold)]"
        />
        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--usha-gold)] px-4 py-3 font-semibold text-[var(--usha-black)] transition hover:opacity-90 disabled:opacity-50"
        >
          {busy && <Loader2 size={16} className="animate-spin" />}
          Logga in
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-[var(--usha-accent)]/10 px-3 py-2 text-sm text-[var(--usha-accent)]">
          {error}
        </p>
      )}

      <p className="mt-6 text-xs text-[var(--usha-muted)]">
        Saknar du konto skapar du det på{" "}
        <a className="underline" href="https://usha.se/signup">
          usha.se
        </a>
        .
      </p>
    </main>
  );
}
