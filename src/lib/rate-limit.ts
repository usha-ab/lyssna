// Enkel takräknare i minnet, per nyckel och glidande fönster.
//
// Den nollställs vid varje kallstart och delas inte mellan instanser. Det
// räcker här: syftet är att en trasig klient eller en nyfiken besökare inte
// ska kunna mala på i all oändlighet, inte att stå emot en attack.

const store = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit = 10, windowMs = 60_000) {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1 };
  }

  entry.count++;
  // Städa bort utgångna nycklar när vi ändå är här, i stället för med en timer.
  if (store.size > 500) {
    for (const [k, v] of Array.from(store.entries())) if (now > v.resetAt) store.delete(k);
  }

  return { allowed: entry.count <= limit, remaining: Math.max(0, limit - entry.count) };
}
