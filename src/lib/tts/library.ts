// Dokumentbiblioteket för uppläsaren.
//
// localStorage är fortfarande den lokala kopian — biblioteket ska öppna direkt
// och fungera utan nät — men sanningen delas numera med servern
// (`listen_documents`, RLS per ägare) så att ett dokument man lägger in i
// mobilen finns på datorn. Synkplanen ligger i sync.ts; här finns lagret.
//
// Texten till ett dokument som kommit hit via synk hämtas först när dokumentet
// öppnas: fyrtio dokument à en halv miljon tecken är inget man drar hem vid
// varje sidladdning. Därför kan `text` vara tom medan `length` ändå vet hur
// långt dokumentet är.

export type DocumentSource = "paste" | "file" | "url" | "pdf" | "epub";

export interface ListenDocument {
  id: string;
  title: string;
  /** Texten, eller "" när den ligger kvar på servern och inte hämtats hit än. */
  text: string;
  /** Hela textens längd i tecken, även när `text` är tom. */
  length: number;
  source: DocumentSource;
  /** Ursprungsadressen för importerade artiklar. */
  url?: string;
  createdAt: number;
  updatedAt: number;
  /** Läspositionen som teckenindex i texten. */
  progress: number;
  /** Ändrad här men ännu inte uppladdad. Sant tills servern kvitterat. */
  dirty?: boolean;
}

/** En radering som ännu inte hunnit nå servern. */
export interface Tombstone {
  id: string;
  deletedAt: number;
}

export const STORAGE_KEY = "usha.listen.documents";
export const TOMBSTONE_KEY = "usha.listen.deleted";

/** Så många dokument sparas lokalt. Äldst uppdaterat faller ur först. */
export const MAX_DOCUMENTS = 40;
/** Taket för ett enskilt dokument — ~250 sidor text. Samma tak som i databasen. */
export const MAX_DOCUMENT_CHARS = 500_000;
/**
 * Taket för hela den lokala kopian. localStorage ger typiskt 5 MB per origin
 * och appen lagrar annat där också, så uppläsaren tar en dryg tredjedel.
 * Dokument som faller ur ligger kvar på servern och hämtas hem vid behov.
 */
export const MAX_TOTAL_CHARS = 1_500_000;
/** Gravstenar äldre än så här har servern hunnit se. */
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Bara det localStorage-API vi faktiskt använder — gör lagret testbart. */
export interface DocumentStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const SOURCES: DocumentSource[] = ["paste", "file", "url", "pdf", "epub"];

function isDocument(value: unknown): value is ListenDocument {
  if (!value || typeof value !== "object") return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.id === "string" &&
    typeof d.title === "string" &&
    typeof d.text === "string" &&
    typeof d.createdAt === "number" &&
    typeof d.updatedAt === "number"
  );
}

function readKey(store: DocumentStore, key: string): unknown {
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Läser den lokala kopian. Trasig eller manipulerad JSON ger tomt bibliotek i
 * stället för ett kastat fel — en läsare som vägrar öppna är värre än en som
 * öppnar tom, särskilt nu när innehållet ändå finns kvar på servern.
 */
export function loadDocuments(store: DocumentStore): ListenDocument[] {
  const parsed = readKey(store, STORAGE_KEY);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isDocument).map((d) => ({
    ...d,
    source: SOURCES.includes(d.source) ? d.source : "paste",
    // Äldre poster saknar length — texten är allt vi har och därmed hela längden.
    length: typeof d.length === "number" && d.length >= 0 ? d.length : d.text.length,
    progress: typeof d.progress === "number" && d.progress >= 0 ? d.progress : 0,
  }));
}

export function loadTombstones(store: DocumentStore): Tombstone[] {
  const parsed = readKey(store, TOMBSTONE_KEY);
  if (!Array.isArray(parsed)) return [];
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  return parsed.filter(
    (t): t is Tombstone =>
      !!t &&
      typeof t === "object" &&
      typeof (t as Tombstone).id === "string" &&
      typeof (t as Tombstone).deletedAt === "number" &&
      (t as Tombstone).deletedAt > cutoff
  );
}

function writeTombstones(store: DocumentStore, tombstones: Tombstone[]): Tombstone[] {
  try {
    store.setItem(TOMBSTONE_KEY, JSON.stringify(tombstones));
  } catch {
    // En gravsten som inte får plats betyder bara att raderingen kan behöva
    // göras om på nästa enhet. Dokumentet är ändå borta härifrån.
  }
  return tombstones;
}

/** Nyast uppdaterat först — bibliotekets visningsordning. */
function sorted(docs: ListenDocument[]): ListenDocument[] {
  return [...docs].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Håller den lokala kopian inom både antals- och teckenbudgeten. Dokument som
 * inte får plats tappas bara härifrån: de ligger kvar på servern.
 */
function prune(docs: ListenDocument[]): ListenDocument[] {
  const kept: ListenDocument[] = [];
  let total = 0;
  for (const doc of sorted(docs).slice(0, MAX_DOCUMENTS)) {
    if (total + doc.text.length > MAX_TOTAL_CHARS && kept.length > 0) {
      // Ett dokument som ännu inte laddats upp får inte kastas — då vore texten
      // borta för gott. Behåll posten, släpp bara texten om den är stor.
      if (doc.dirty) kept.push(doc);
      continue;
    }
    kept.push(doc);
    total += doc.text.length;
  }
  return kept;
}

/**
 * Skriver den lokala kopian. Slår kvoten i taket släpps texten ur det äldsta
 * dokumentet (posten och läspositionen finns kvar, texten hämtas från servern
 * nästa gång), så att ett nytt dokument aldrig går förlorat.
 */
function persist(store: DocumentStore, docs: ListenDocument[]): ListenDocument[] {
  let candidates = prune(docs);
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(candidates));
      return candidates;
    } catch {
      // Äldsta dokumentet med text kvar får släppa den. Osparade dokument
      // (dirty) rörs sist av allt. Positionen i listan är sista utslaget: två
      // dokument kan bära samma millisekund, och då är det som ligger längst
      // ned (äldst) som ska släppa texten — inte det som just lades till.
      const index = candidates
        .map((d, i) => ({ d, i }))
        .filter(({ d }) => d.text.length > 0)
        .sort(
          (a, b) =>
            Number(a.d.dirty) - Number(b.d.dirty) ||
            a.d.updatedAt - b.d.updatedAt ||
            b.i - a.i
        )[0]?.i;
      if (index === undefined) break;
      candidates = candidates.map((d, i) => (i === index ? { ...d, text: "" } : d));
    }
  }
  return candidates;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Första raden med innehåll, kortad — bättre än "Namnlöst" som titel. */
export function titleFromText(text: string, fallback: string): string {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return fallback;
  return line.length > 60 ? `${line.slice(0, 60).trimEnd()}…` : line;
}

export interface NewDocument {
  title?: string;
  text: string;
  source: DocumentSource;
  url?: string;
}

/** Lägger till ett dokument och returnerar det sparade biblioteket. */
export function addDocument(
  store: DocumentStore,
  input: NewDocument,
  fallbackTitle = "Namnlöst dokument"
): { documents: ListenDocument[]; document: ListenDocument } {
  const now = Date.now();
  const text = input.text.slice(0, MAX_DOCUMENT_CHARS);
  const document: ListenDocument = {
    id: makeId(),
    title: (input.title?.trim() || titleFromText(text, fallbackTitle)).slice(0, 120),
    text,
    length: text.length,
    source: input.source,
    ...(input.url ? { url: input.url } : {}),
    createdAt: now,
    updatedAt: now,
    progress: 0,
    dirty: true,
  };
  const documents = persist(store, [document, ...loadDocuments(store)]);
  return { documents, document };
}

/** Raderar lokalt och lämnar en gravsten så att synken tar bort på servern. */
export function deleteDocument(
  store: DocumentStore,
  id: string
): { documents: ListenDocument[]; tombstones: Tombstone[] } {
  const documents = persist(
    store,
    loadDocuments(store).filter((d) => d.id !== id)
  );
  const tombstones = writeTombstones(store, [
    ...loadTombstones(store).filter((t) => t.id !== id),
    { id, deletedAt: Date.now() },
  ]);
  return { documents, tombstones };
}

/** Städar bort gravstenar som servern kvitterat. */
export function clearTombstones(store: DocumentStore, ids: string[]): Tombstone[] {
  const done = new Set(ids);
  return writeTombstones(
    store,
    loadTombstones(store).filter((t) => !done.has(t.id))
  );
}

/**
 * Sparar läspositionen. Den räknas som en ändring och flyttar dokumentet
 * överst i biblioteket — det man lyssnar på är det man vill hitta först — och
 * den vinner därmed också över en äldre position från en annan enhet.
 */
export function saveProgress(
  store: DocumentStore,
  id: string,
  progress: number
): ListenDocument[] {
  const docs = loadDocuments(store);
  const target = docs.find((d) => d.id === id);
  if (!target) return docs;
  const clamped = Math.max(0, Math.min(Math.round(progress), target.length));
  if (clamped === target.progress) return docs;
  return persist(
    store,
    docs.map((d) =>
      d.id === id ? { ...d, progress: clamped, updatedAt: Date.now(), dirty: true } : d
    )
  );
}

export function renameDocument(
  store: DocumentStore,
  id: string,
  title: string
): ListenDocument[] {
  const trimmed = title.trim().slice(0, 120);
  if (!trimmed) return loadDocuments(store);
  return persist(
    store,
    loadDocuments(store).map((d) =>
      d.id === id ? { ...d, title: trimmed, updatedAt: Date.now(), dirty: true } : d
    )
  );
}

/** Skriver hela biblioteket — synken använder den efter en sammanslagning. */
export function replaceDocuments(
  store: DocumentStore,
  docs: ListenDocument[]
): ListenDocument[] {
  return persist(store, docs);
}

/** Lägger in en hämtad text i den lokala kopian. */
export function storeText(
  store: DocumentStore,
  id: string,
  text: string
): ListenDocument[] {
  return persist(
    store,
    loadDocuments(store).map((d) =>
      d.id === id ? { ...d, text, length: text.length } : d
    )
  );
}

/** Andel uppläst, 0–1. Ett tomt dokument räknas som oläst, inte färdigt. */
export function progressRatio(doc: ListenDocument): number {
  if (doc.length === 0) return 0;
  return Math.max(0, Math.min(1, doc.progress / doc.length));
}
