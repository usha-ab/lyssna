// Sammanslagningen mellan den lokala kopian och servern.
//
// Samma dokument kan ha ändrats på två enheter — en läsposition i mobilen, en
// omdöpning på datorn. Regeln är den enklaste som håller: senaste ändringen
// vinner, per dokument. Det duger här eftersom ändringarna är små och ägaren
// är en och samma person; ett dokument kan inte redigeras av två parter.
//
// Raderingar behöver gravstenar. Utan dem skulle ett dokument som tagits bort
// på en enhet komma tillbaka från servern vid nästa synk.

import type { ListenDocument, Tombstone, DocumentSource } from "./library";

/** Bibliotekslistan som servern skickar — utan texterna. */
export interface RemoteSummary {
  id: string;
  title: string;
  source: string;
  source_url: string | null;
  progress: number;
  created_at: string;
  updated_at: string;
  content_length: number;
}

export interface SyncPlan {
  /** Dokument vars text ska laddas upp (lokalt nyare eller helt nya). */
  upload: ListenDocument[];
  /** Dokument som ska bort på servern. */
  deleteRemote: string[];
  /** Biblioteket efter sammanslagningen. */
  documents: ListenDocument[];
}

const SOURCES: DocumentSource[] = ["paste", "file", "url", "pdf", "epub"];

function toSource(value: string): DocumentSource {
  return SOURCES.includes(value as DocumentSource) ? (value as DocumentSource) : "paste";
}

/** Fjärrpostens metadata som ett lokalt dokument, utan text. */
function adopt(remote: RemoteSummary, keepText = ""): ListenDocument {
  return {
    id: remote.id,
    title: remote.title,
    text: keepText,
    length: remote.content_length,
    source: toSource(remote.source),
    ...(remote.source_url ? { url: remote.source_url } : {}),
    createdAt: Date.parse(remote.created_at) || Date.now(),
    updatedAt: Date.parse(remote.updated_at) || Date.now(),
    progress: Math.max(0, remote.progress),
    dirty: false,
  };
}

/**
 * Räknar ut vad som ska laddas upp, tas bort och hur biblioteket ser ut efter
 * synken. Ren funktion — inga anrop, så den går att testa på alla de fall som
 * annars bara syns med två riktiga enheter.
 */
export function planSync(
  local: ListenDocument[],
  remote: RemoteSummary[],
  tombstones: Tombstone[]
): SyncPlan {
  const deleted = new Map(tombstones.map((t) => [t.id, t.deletedAt]));
  const remoteById = new Map(remote.map((r) => [r.id, r]));
  const documents: ListenDocument[] = [];
  const upload: ListenDocument[] = [];
  const deleteRemote: string[] = [];

  for (const doc of local) {
    if (deleted.has(doc.id)) continue; // raderad här: aldrig kvar lokalt
    const match = remoteById.get(doc.id);
    remoteById.delete(doc.id);

    if (!match) {
      documents.push(doc);
      // Finns inte på servern. Har vi texten laddar vi upp den; annars är det
      // en post vars text redan tappats lokalt och inget vi kan återskapa.
      if (doc.text.length > 0) upload.push(doc);
      continue;
    }

    const remoteAt = Date.parse(match.updated_at) || 0;
    if (doc.updatedAt > remoteAt) {
      documents.push(doc);
      if (doc.text.length > 0) upload.push(doc);
      continue;
    }

    // Servern är nyare. Texten behålls bara om den fortfarande är samma text —
    // annars måste den hämtas om, och tom text betyder just det.
    const sameText = doc.text.length === match.content_length;
    documents.push(adopt(match, sameText ? doc.text : ""));
  }

  // Kvar i remoteById: dokument den här enheten inte känner till.
  for (const match of Array.from(remoteById.values())) {
    if (deleted.has(match.id)) {
      deleteRemote.push(match.id);
      continue;
    }
    documents.push(adopt(match));
  }

  // Gravstenar för dokument servern redan saknar är avklarade — de tas med i
  // deleteRemote ändå så att anroparen kan städa bort dem i ett svep.
  for (const [id] of Array.from(deleted.entries())) {
    if (!deleteRemote.includes(id)) deleteRemote.push(id);
  }

  documents.sort((a, b) => b.updatedAt - a.updatedAt);
  return { upload, deleteRemote, documents };
}
