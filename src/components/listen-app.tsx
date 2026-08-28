"use client";

// Uppläsaren: lägg in en text, lyssna på den, hitta tillbaka till den.
//
// Biblioteket ligger både lokalt (localStorage, så att vyn öppnar direkt och
// fungerar utan nät) och på kontot (`listen_documents` med RLS, så att det
// följer med mellan enheter). Synken sker vid öppning och efter varje
// ändring; misslyckas den ligger ändringen kvar som osparad och tas nästa
// gång. Se client-sync.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStrings } from "@/lib/strings";
import {
  Check,
  ClipboardPaste,
  CloudOff,
  FileText,
  Headphones,
  Link2,
  Loader2,
  Play,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import {
  addDocument,
  deleteDocument,
  loadDocuments,
  progressRatio,
  saveProgress,
  type DocumentSource,
  type ListenDocument,
} from "@/lib/tts/library";
import { ensureText, httpApi, syncLibrary, type SyncStatus } from "@/lib/tts/client-sync";
import { countWords, estimateSeconds, formatDuration } from "@/lib/tts/segment";
import { EpubError, parseEpub, type EpubErrorCode } from "@/lib/tts/epub";
import { PdfError, parsePdf, type PdfErrorCode } from "@/lib/tts/pdf";
import { Reader } from "./reader";

type Tab = "paste" | "file" | "url";

/** Filtyper vi kan läsa. PDF och EPUB tolkas i webbläsaren, resten är text. */
const ACCEPTED_FILES = ".txt,.md,.markdown,.csv,.json,.pdf,.epub,text/plain,application/pdf,application/epub+zip";
/** En PDF eller EPUB kan vara stor; texten den ger ifrån sig är det sällan. */
const MAX_FILE_BYTES = 60 * 1024 * 1024;

/** Bibliotekens felkoder översatta till meddelanden användaren förstår. */
const PDF_ERROR_KEYS: Record<PdfErrorCode, string> = {
  unreadable: "errorPdfUnreadable",
  "no-text": "errorPdfNoText",
};

const EPUB_ERROR_KEYS: Record<EpubErrorCode, string> = {
  "not-an-archive": "errorEpubNotArchive",
  "no-container": "errorEpubBroken",
  "no-content-file": "errorEpubBroken",
  "unsupported-compression": "errorEpubCompression",
  "no-text": "errorEpubNoText",
};

export function ListenApp() {
  const t = useStrings();
  const [documents, setDocuments] = useState<ListenDocument[]>([]);
  const [active, setActive] = useState<ListenDocument | null>(null);
  const [tab, setTab] = useState<Tab>("paste");
  const [pasted, setPasted] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  // Läspositionen sparas ofta. Servern behöver inte varje sparning direkt, så
  // anropet skickas i bakgrunden och får misslyckas.
  const activeIdRef = useRef<string | null>(null);
  // Utloggad finns ingen server att prata med. Utan den här spärren skulle
  // varje sparning och radering skicka ett anrop som bara kan bli 401.
  const remoteRef = useRef(true);

  const runSync = useCallback(async (force = false) => {
    if (!force && !remoteRef.current) return;
    setSyncing(true);
    try {
      const result = await syncLibrary(window.localStorage, httpApi);
      remoteRef.current = result.status !== "signed-out";
      setDocuments(result.documents);
      setSyncStatus(result.status);
    } finally {
      setSyncing(false);
    }
  }, []);

  // Lokalt först — vyn ska aldrig vänta på nätet — och sedan synk.
  useEffect(() => {
    setDocuments(loadDocuments(window.localStorage));
    setReady(true);
    void runSync(true);
  }, [runSync]);

  const handleProgress = useCallback((offset: number) => {
    const id = activeIdRef.current;
    if (!id) return;
    setDocuments(saveProgress(window.localStorage, id, offset));
    if (!remoteRef.current) return;
    void httpApi.patchProgress(id, offset).catch(() => {
      // Ligger kvar som osparad ändring och går upp vid nästa synk.
    });
  }, []);

  const add = useCallback(
    (input: { title?: string; text: string; source: DocumentSource; url?: string }) => {
      const text = input.text.trim();
      if (text.length === 0) {
        setError(t("errorEmpty"));
        return;
      }
      const { documents: next, document } = addDocument(
        window.localStorage,
        { ...input, text },
        t("untitled")
      );
      setDocuments(next);
      activeIdRef.current = document.id;
      setActive(document);
      setError(null);
      setPasted("");
      setUrl("");
      if (remoteRef.current) {
        void httpApi.upload(document).then(
          () => void runSync(),
          () => {
            // Osparad tills vidare; synken tar den senare.
          }
        );
      }
    },
    [t, runSync]
  );

  const importUrl = useCallback(async () => {
    if (!url.trim()) return;
    setBusy(t("importing"));
    setError(null);
    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = (await response.json()) as { title?: string; text?: string; url?: string; error?: string };
      if (!response.ok || !data.text) {
        setError(data.error ?? t("errorImport"));
        return;
      }
      add({ title: data.title, text: data.text, source: "url", url: data.url });
    } catch {
      setError(t("errorImport"));
    } finally {
      setBusy(null);
    }
  }, [url, add, t]);

  const importFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_FILE_BYTES) {
        setError(t("errorFileSize"));
        return;
      }
      const name = file.name.toLowerCase();
      const title = file.name.replace(/\.[^.]+$/, "");
      setError(null);
      setBusy(t("reading"));
      try {
        if (name.endsWith(".pdf")) {
          const pdf = await parsePdf(await file.arrayBuffer(), {
            onProgress: (page, total) => setBusy(t("readingPage", { page, total })),
          });
          add({ title: pdf.title || title, text: pdf.text, source: "pdf" });
        } else if (name.endsWith(".epub")) {
          const book = await parseEpub(await file.arrayBuffer());
          add({ title: book.title || title, text: book.text, source: "epub" });
        } else {
          add({ title, text: await file.text(), source: "file" });
        }
      } catch (caught) {
        if (caught instanceof PdfError) setError(t(PDF_ERROR_KEYS[caught.code]));
        else if (caught instanceof EpubError) setError(t(EPUB_ERROR_KEYS[caught.code]));
        else setError(t("errorFileRead"));
      } finally {
        setBusy(null);
      }
    },
    [add, t]
  );

  const open = useCallback(
    async (doc: ListenDocument) => {
      // Ett dokument som kommit hit via synk har bara metadata tills nu.
      if (doc.text.length > 0) {
        activeIdRef.current = doc.id;
        setActive(doc);
        return;
      }
      if (!remoteRef.current) {
        setError(t("errorFetchText"));
        return;
      }
      setOpening(doc.id);
      setError(null);
      try {
        const filled = await ensureText(window.localStorage, httpApi, doc);
        if (filled.text.length === 0) {
          setError(t("errorFetchText"));
          return;
        }
        setDocuments(loadDocuments(window.localStorage));
        activeIdRef.current = filled.id;
        setActive(filled);
      } catch {
        setError(t("errorFetchText"));
      } finally {
        setOpening(null);
      }
    },
    [t]
  );

  const remove = useCallback(
    (doc: ListenDocument) => {
      if (!window.confirm(t("deleteConfirm", { title: doc.title }))) return;
      setDocuments(deleteDocument(window.localStorage, doc.id).documents);
      if (!remoteRef.current) return;
      void httpApi.remove(doc.id).catch(() => {
        // Gravstenen ligger kvar och raderingen görs om vid nästa synk.
      });
    },
    [t]
  );

  const close = useCallback(() => {
    activeIdRef.current = null;
    setActive(null);
    setDocuments(loadDocuments(window.localStorage));
    void runSync();
  }, [runSync]);

  const pastedWords = useMemo(() => countWords(pasted), [pasted]);

  if (active) {
    return <Reader document={active} onProgress={handleProgress} onClose={close} />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <header>
        <div className="mb-1 flex items-center gap-2">
          <Headphones size={22} className="text-[var(--usha-gold)]" />
          <h1 className="text-2xl font-bold">{t("title")}</h1>
        </div>
        <p className="text-sm text-[var(--usha-muted)]">{t("subtitle")}</p>
      </header>

      <section className="rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4">
        <div className="mb-3 flex gap-1 rounded-xl bg-[var(--usha-black)] p-1">
          {([
            ["paste", ClipboardPaste, t("tabPaste")],
            ["file", Upload, t("tabFile")],
            ["url", Link2, t("tabUrl")],
          ] as const).map(([key, Icon, label]) => (
            <button
              key={key}
              onClick={() => {
                setTab(key);
                setError(null);
              }}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm transition ${
                tab === key
                  ? "bg-[var(--usha-gold)] font-semibold text-[var(--usha-black)]"
                  : "text-[var(--usha-muted)] hover:text-[var(--usha-white)]"
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>

        {tab === "paste" && (
          <div className="space-y-3">
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={6}
              placeholder={t("pastePlaceholder")}
              className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-black)] p-3 text-sm text-[var(--usha-white)] outline-none focus:border-[var(--usha-gold)]"
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-[var(--usha-muted)]">
                {t("wordCount", {
                  words: pastedWords,
                  duration: formatDuration(estimateSeconds(pastedWords)),
                })}
              </span>
              <button
                onClick={() => add({ text: pasted, source: "paste" })}
                disabled={pasted.trim().length === 0}
                className="rounded-xl bg-[var(--usha-gold)] px-4 py-2 text-sm font-semibold text-[var(--usha-black)] transition hover:opacity-90 disabled:opacity-40"
              >
                {t("listenAction")}
              </button>
            </div>
          </div>
        )}

        {tab === "file" && (
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--usha-border)] p-6 text-center transition hover:border-[var(--usha-gold)]/60">
            {busy ? (
              <Loader2 size={22} className="animate-spin text-[var(--usha-gold)]" />
            ) : (
              <Upload size={22} className="text-[var(--usha-gold)]" />
            )}
            <span className="text-sm font-medium">{busy ?? t("fileCta")}</span>
            <span className="text-xs text-[var(--usha-muted)]">{t("fileHint")}</span>
            <input
              type="file"
              accept={ACCEPTED_FILES}
              className="hidden"
              disabled={busy !== null}
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Nollställ så att samma fil kan väljas igen efter ett fel.
                e.target.value = "";
                if (file) void importFile(file);
              }}
            />
          </label>
        )}

        {tab === "url" && (
          <div className="space-y-3">
            <input
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void importUrl();
              }}
              placeholder="https://…"
              className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-black)] p-3 text-sm text-[var(--usha-white)] outline-none focus:border-[var(--usha-gold)]"
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-[var(--usha-muted)]">{t("urlHint")}</span>
              <button
                onClick={() => void importUrl()}
                disabled={busy !== null || url.trim().length === 0}
                className="flex items-center gap-2 rounded-xl bg-[var(--usha-gold)] px-4 py-2 text-sm font-semibold text-[var(--usha-black)] transition hover:opacity-90 disabled:opacity-40"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                {t("importAction")}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 rounded-xl bg-[var(--usha-accent)]/10 px-3 py-2 text-sm text-[var(--usha-accent)]">
            {error}
          </p>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--usha-muted)]">
            {t("libraryHeading")}
          </h2>
          <SyncBadge status={syncStatus} syncing={syncing} onRetry={() => void runSync(true)} />
        </div>

        {!ready ? (
          <p className="text-sm text-[var(--usha-muted)]">{t("loading")}</p>
        ) : documents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--usha-border)] p-6 text-center">
            <FileText size={22} className="mx-auto mb-2 text-[var(--usha-muted)]" />
            <p className="text-sm text-[var(--usha-muted)]">{t("libraryEmpty")}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {documents.map((doc) => {
              // Ord räknas ur texten när den finns här, annars uppskattas de ur
              // längden: ett svenskt ord är i snitt drygt sex tecken med blanksteg.
              const words = doc.text.length > 0 ? countWords(doc.text) : Math.round(doc.length / 6.5);
              const percent = Math.round(progressRatio(doc) * 100);
              return (
                <li
                  key={doc.id}
                  className="flex items-center gap-3 rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-3"
                >
                  <button
                    onClick={() => void open(doc)}
                    disabled={opening === doc.id}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--usha-gold)]/10 text-[var(--usha-gold)]">
                      {opening === doc.id ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Play size={16} />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{doc.title}</span>
                      <span className="block text-xs text-[var(--usha-muted)]">
                        {t("wordCount", { words, duration: formatDuration(estimateSeconds(words)) })}
                        {percent > 0 && ` · ${t("progress", { percent })}`}
                      </span>
                    </span>
                  </button>
                  <button
                    aria-label={t("delete")}
                    onClick={() => remove(doc)}
                    className="rounded-lg p-2 text-[var(--usha-muted)] transition hover:text-[var(--usha-accent)]"
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-3 text-xs text-[var(--usha-muted)]">
          {syncStatus === "signed-out" ? t("privacyLocal") : t("privacySynced")}
        </p>
      </section>
    </div>
  );
}

/** Var biblioteket står: synkat, bara här, eller väntande på nät. */
function SyncBadge({
  status,
  syncing,
  onRetry,
}: {
  status: SyncStatus | null;
  syncing: boolean;
  onRetry: () => void;
}) {
  const t = useStrings();
  if (syncing) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-[var(--usha-muted)]">
        <Loader2 size={12} className="animate-spin" /> {t("syncing")}
      </span>
    );
  }
  if (status === "synced") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-[var(--usha-muted)]">
        <Check size={12} className="text-[var(--usha-gold)]" /> {t("syncOk")}
      </span>
    );
  }
  if (status === "offline") {
    return (
      <button
        onClick={onRetry}
        className="flex items-center gap-1.5 text-xs text-[var(--usha-muted)] transition hover:text-[var(--usha-white)]"
      >
        <RefreshCw size={12} /> {t("syncOffline")}
      </button>
    );
  }
  if (status === "signed-out") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-[var(--usha-muted)]">
        <CloudOff size={12} /> {t("syncLocalOnly")}
      </span>
    );
  }
  return null;
}
