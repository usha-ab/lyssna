"use client";

// Synken mot servern: hämta listan, ladda upp det som ändrats här, radera det
// som raderats här. Planen räknas ut av planSync (sync.ts); här körs den.
//
// Allt är avsiktligt förlåtande. Tappar nätet, eller är man utloggad, ska
// biblioteket ändå fungera lokalt — synken märks då bara på att ändringar
// ligger kvar som osparade tills nästa gång.

import {
  clearTombstones,
  loadDocuments,
  loadTombstones,
  replaceDocuments,
  storeText,
  type DocumentStore,
  type ListenDocument,
} from "./library";
import { planSync, type RemoteSummary } from "./sync";

export interface RemoteApi {
  list(): Promise<RemoteSummary[]>;
  upload(doc: ListenDocument): Promise<void>;
  /** Bara läspositionen — sparas ofta, och texten behöver inte skickas om. */
  patchProgress(id: string, progress: number): Promise<void>;
  remove(id: string): Promise<void>;
  fetchText(id: string): Promise<string>;
}

/** Kastas när användaren inte är inloggad — då finns ingen server att synka mot. */
export class NotSignedIn extends Error {}

async function json<T>(response: Response): Promise<T> {
  if (response.status === 401) throw new NotSignedIn();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

export const httpApi: RemoteApi = {
  async list() {
    const data = await json<{ documents: RemoteSummary[] }>(
      await fetch("/api/documents", { cache: "no-store" })
    );
    return data.documents ?? [];
  },
  async upload(doc) {
    await json(
      await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: doc.id,
          title: doc.title,
          content: doc.text,
          source: doc.source,
          sourceUrl: doc.url ?? null,
          progress: doc.progress,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        }),
      })
    );
  },
  async patchProgress(id, progress) {
    await json(
      await fetch(`/api/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ progress }),
      })
    );
  },
  async remove(id) {
    const response = await fetch(`/api/documents/${id}`, { method: "DELETE" });
    // Ett dokument som redan är borta är ett avklarat ärende, inte ett fel.
    if (response.status === 404) return;
    await json(response);
  },
  async fetchText(id) {
    const data = await json<{ document: { content: string } }>(
      await fetch(`/api/documents/${id}`, { cache: "no-store" })
    );
    return data.document?.content ?? "";
  },
};

export type SyncStatus = "synced" | "offline" | "signed-out";

export interface SyncResult {
  documents: ListenDocument[];
  status: SyncStatus;
}

/** Kör en synk och returnerar biblioteket som det ser ut efteråt. */
export async function syncLibrary(store: DocumentStore, api: RemoteApi): Promise<SyncResult> {
  const local = loadDocuments(store);

  let remote: RemoteSummary[];
  try {
    remote = await api.list();
  } catch (error) {
    return {
      documents: local,
      status: error instanceof NotSignedIn ? "signed-out" : "offline",
    };
  }

  const plan = planSync(local, remote, loadTombstones(store));

  const deleted: string[] = [];
  for (const id of plan.deleteRemote) {
    try {
      await api.remove(id);
      deleted.push(id);
    } catch {
      // Får stå kvar som gravsten och försökas igen nästa gång.
    }
  }
  if (deleted.length > 0) clearTombstones(store, deleted);

  const uploaded = new Set<string>();
  for (const doc of plan.upload) {
    try {
      await api.upload(doc);
      uploaded.add(doc.id);
    } catch {
      // Behåller dirty-flaggan; nästa synk tar om den.
    }
  }

  const documents = replaceDocuments(
    store,
    plan.documents.map((d) => (uploaded.has(d.id) ? { ...d, dirty: false } : d))
  );

  return { documents, status: "synced" };
}

/**
 * Ser till att dokumentets text finns här. Ett dokument som kommit via synk
 * har bara metadata tills det öppnas första gången på den här enheten.
 */
export async function ensureText(
  store: DocumentStore,
  api: RemoteApi,
  doc: ListenDocument
): Promise<ListenDocument> {
  if (doc.text.length > 0) return doc;
  const text = await api.fetchText(doc.id);
  if (!text) return doc;
  const documents = storeText(store, doc.id, text);
  return documents.find((d) => d.id === doc.id) ?? { ...doc, text, length: text.length };
}
