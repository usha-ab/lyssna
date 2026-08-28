// Grind för artikelimporten.
//
// Rutten hämtar en adress som användaren skriver in, från servern. Utan
// kontroll blir den en öppen proxy in i det interna nätet: molnleverantörers
// metadatatjänst på 169.254.169.254, databaser på 10.x, allt som svarar på
// localhost. Här avgörs vad som får hämtas — både adressen och, efter
// DNS-uppslag, den IP den faktiskt pekar på.

export type UrlRejection =
  | "invalid"
  | "protocol"
  | "private"
  | "credentials"
  | "port";

/** Portar värda att öppna. 80/443 plus de vanliga utvecklingsportarna utesluts inte här — de fångas av privat-IP-kontrollen. */
const BLOCKED_PORTS = new Set([22, 23, 25, 3306, 5432, 6379, 9200, 11211, 27017]);

function ipv4Private(parts: number[]): boolean {
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local, inkl. molnens metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast och reserverat
  return false;
}

/** Är adressen en IP som inte får nås utifrån? */
export function isPrivateAddress(host: string): boolean {
  const value = host.trim().replace(/^\[|\]$/g, "").toLowerCase();

  const v4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const parts = v4.slice(1).map(Number);
    if (parts.some((n) => n > 255)) return true; // ogiltig — släpp inte igenom
    return ipv4Private(parts);
  }

  if (value.includes(":")) {
    // IPv4-mappad IPv6 (::ffff:10.0.0.1) döljer annars en privat adress.
    const mapped = value.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (value === "::1" || value === "::") return true;
    const head = parseInt(value.split(":")[0] || "0", 16);
    if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7, unique local
    if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10, link-local
    return false;
  }

  return false;
}

/** Värdnamn som aldrig ska hämtas, oavsett vad DNS säger. */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) return true;
  if (host === "metadata" || host === "metadata.google.internal") return true;
  return isPrivateAddress(host);
}

export type UrlCheck =
  | { ok: true; url: URL }
  | { ok: false; reason: UrlRejection };

/** Kontrollerar en adress innan den hämtas. */
export function checkUrl(input: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "protocol" };
  }
  // Inloggningsuppgifter i adressen är alltid ett försök att nå något annat
  // än en publik artikel.
  if (url.username || url.password) return { ok: false, reason: "credentials" };
  if (url.port && BLOCKED_PORTS.has(Number(url.port))) return { ok: false, reason: "port" };
  if (isBlockedHostname(url.hostname)) return { ok: false, reason: "private" };
  return { ok: true, url };
}
