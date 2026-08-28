"use client";

// Läsvyn: texten till vänster om ögat, spelaren under tummen.
//
// Den mening som talas markeras och det ord som just läses fetstilas, så att
// blicken kan följa med i stället för att leta. Klick i texten hoppar dit —
// det är den enda navigeringen som känns naturlig i ett dokument.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStrings } from "@/lib/strings";
import {
  ChevronLeft,
  Gauge,
  Loader2,
  Minus,
  Pause,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  Square,
  Volume2,
} from "lucide-react";
import {
  countWords,
  estimateSeconds,
  formatDuration,
  segmentAtOffset,
  splitSentences,
} from "@/lib/tts/segment";
import { MAX_RATE, MIN_RATE, useSpeech } from "@/lib/tts/use-speech";
import { useMediaSession } from "@/lib/tts/use-media-session";
import type { ListenDocument } from "@/lib/tts/library";

const SETTINGS_KEY = "usha.listen.settings";
const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const FONT_SIZES = ["text-base", "text-lg", "text-xl", "text-2xl"] as const;

/**
 * Över den här storleken renderas bara ett fönster runt läspositionen. Ett
 * dokument på hundratusen tecken blir annars tiotusentals DOM-noder och
 * sidan hackar vid varje meningsbyte.
 */
const FULL_RENDER_LIMIT = 800;
const WINDOW_RADIUS = 300;

interface ReaderSettings {
  rate: number;
  voiceUri: string | null;
  fontStep: number;
}

function loadSettings(): ReaderSettings {
  const fallback: ReaderSettings = { rate: 1, voiceUri: null, fontStep: 1 };
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
    return {
      rate: typeof parsed.rate === "number" ? parsed.rate : fallback.rate,
      voiceUri: typeof parsed.voiceUri === "string" ? parsed.voiceUri : null,
      fontStep:
        typeof parsed.fontStep === "number"
          ? Math.min(FONT_SIZES.length - 1, Math.max(0, parsed.fontStep))
          : fallback.fontStep,
    };
  } catch {
    return fallback;
  }
}

function saveSettings(settings: ReaderSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Blockerad lagring gör bara att inställningen inte minns till nästa gång.
  }
}

interface ReaderProps {
  document: ListenDocument;
  onProgress: (offset: number) => void;
  onClose: () => void;
}

export function Reader({ document: doc, onProgress, onClose }: ReaderProps) {
  const t = useStrings();
  const segments = useMemo(() => splitSentences(doc.text), [doc.text]);
  const [fontStep, setFontStep] = useState(1);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const activeRef = useRef<HTMLSpanElement | null>(null);
  const lastSavedRef = useRef(0);
  const speechIndexRef = useRef(0);

  // Läspositionen sparas högst var femte sekund. Varje sparning skriver om
  // hela biblioteket, och en skrivning per mening skulle hacka uppspelningen.
  const handleSegment = useCallback(
    (segment: { start: number }) => {
      const now = Date.now();
      if (now - lastSavedRef.current < 5000) return;
      lastSavedRef.current = now;
      onProgress(segment.start);
    },
    [onProgress]
  );

  const speech = useSpeech({ segments, onSegmentChange: handleSegment });
  const { play, pause, toggle, stop, skip, seek, setRate, setVoiceUri, status } = speech;

  // Sparade inställningar och läsposition läses efter montering — de finns
  // bara i webbläsaren, och servern renderar samma sida utan dem.
  useEffect(() => {
    const settings = loadSettings();
    setFontStep(settings.fontStep);
    setRate(settings.rate);
    if (settings.voiceUri) setVoiceUri(settings.voiceUri);
    if (doc.progress > 0) seek(segmentAtOffset(segments, doc.progress));
    setSettingsLoaded(true);
    // Bara vid byte av dokument: annars skulle en ändrad hastighet skrivas
    // tillbaka av sitt eget sparade värde.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  useEffect(() => {
    if (!settingsLoaded) return;
    saveSettings({ rate: speech.rate, voiceUri: speech.voiceUri, fontStep });
  }, [settingsLoaded, speech.rate, speech.voiceUri, fontStep]);

  // Positionen sparas också när vyn lämnas, så att sista meningen inte tappas
  // av throttlingen ovan.
  useEffect(() => {
    return () => {
      const segment = segments[speechIndexRef.current];
      if (segment) onProgress(segment.start);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, onProgress]);

  useEffect(() => {
    speechIndexRef.current = speech.segmentIndex;
  }, [speech.segmentIndex]);

  // Följ med i texten. `nearest` i stället för `center` när användaren just
  // scrollat själv hade krävt scrollspårning — här väger det tyngre att raden
  // alltid syns.
  useEffect(() => {
    activeRef.current?.scrollIntoView({
      block: "center",
      behavior: status === "playing" ? "smooth" : "auto",
    });
  }, [speech.segmentIndex, status]);

  // Tangentbord: mellanslag spelar och pausar, piltangenter hoppar mening.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === " ") {
        event.preventDefault();
        toggle();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        skip(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        skip(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, skip]);

  // Låsskärm, notis och hörlurarnas knappar styr samma uppläsning som
  // knappraden nedan — och det tysta spåret håller sidan vaken när skärmen
  // släcks. Se use-media-session.ts för vad det inte räcker till.
  useMediaSession({
    active: true,
    playing: status === "playing",
    title: doc.title,
    subtitle: segments[speech.segmentIndex]?.text.slice(0, 80),
    onPlay: play,
    onPause: pause,
    onNext: () => skip(1),
    onPrevious: () => skip(-1),
    onStop: stop,
  });

  const totalWords = useMemo(() => countWords(doc.text), [doc.text]);
  const current = segments[speech.segmentIndex];
  const readOffset = current ? current.start : 0;
  const ratio = doc.text.length > 0 ? readOffset / doc.text.length : 0;
  const remaining = estimateSeconds(Math.round(totalWords * (1 - ratio)), speech.rate);

  const visible = useMemo(() => {
    if (segments.length <= FULL_RENDER_LIMIT) return segments;
    const from = Math.max(0, speech.segmentIndex - WINDOW_RADIUS);
    return segments.slice(from, from + WINDOW_RADIUS * 2);
  }, [segments, speech.segmentIndex]);

  if (!speech.supported) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <button onClick={onClose} className="mb-4 flex items-center gap-1 text-sm text-[var(--usha-muted)]">
          <ChevronLeft size={16} /> {t("back")}
        </button>
        <p className="rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-6 text-[var(--usha-muted)]">
          {t("unsupported")}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pb-40 pt-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            onClick={onClose}
            className="mb-1 flex items-center gap-1 text-sm text-[var(--usha-muted)] transition hover:text-[var(--usha-white)]"
          >
            <ChevronLeft size={16} /> {t("back")}
          </button>
          <h1 className="truncate text-xl font-bold">{doc.title}</h1>
          <p className="text-xs text-[var(--usha-muted)]">
            {t("meta", {
              words: totalWords,
              duration: formatDuration(estimateSeconds(totalWords, speech.rate)),
            })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            aria-label={t("smallerText")}
            onClick={() => setFontStep((s) => Math.max(0, s - 1))}
            className="rounded-lg border border-[var(--usha-border)] p-2 text-[var(--usha-muted)] transition hover:text-[var(--usha-white)]"
          >
            <Minus size={14} />
          </button>
          <button
            aria-label={t("largerText")}
            onClick={() => setFontStep((s) => Math.min(FONT_SIZES.length - 1, s + 1))}
            className="rounded-lg border border-[var(--usha-border)] p-2 text-[var(--usha-muted)] transition hover:text-[var(--usha-white)]"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {segments.length > FULL_RENDER_LIMIT && (
        <p className="mb-3 rounded-xl bg-[var(--usha-card)] px-3 py-2 text-xs text-[var(--usha-muted)]">
          {t("longDocumentNotice")}
        </p>
      )}

      <article
        className={`whitespace-pre-wrap leading-relaxed ${FONT_SIZES[fontStep]}`}
      >
        {visible.map((segment, i) => {
          const previous = visible[i - 1];
          const gap = previous ? doc.text.slice(previous.end, segment.start) : "";
          const isActive = segment.index === speech.segmentIndex;
          const wordRange =
            isActive && speech.word && speech.word.start >= segment.start && speech.word.end <= segment.end
              ? speech.word
              : null;

          return (
            <span key={segment.index}>
              {gap}
              <span
                ref={isActive ? activeRef : undefined}
                onClick={() => {
                  seek(segment.index);
                  if (status !== "playing") play(segment.index);
                }}
                className={`cursor-pointer rounded transition-colors ${
                  isActive
                    ? "bg-[var(--usha-gold)]/30 text-[var(--usha-white)]"
                    : "hover:bg-[var(--usha-card-hover)]"
                }`}
              >
                {wordRange ? (
                  <>
                    {doc.text.slice(segment.start, wordRange.start)}
                    <mark className="rounded bg-[var(--usha-gold)] text-[var(--usha-black)]">
                      {doc.text.slice(wordRange.start, wordRange.end)}
                    </mark>
                    {doc.text.slice(wordRange.end, segment.end)}
                  </>
                ) : (
                  segment.text
                )}
              </span>
            </span>
          );
        })}
      </article>

      {/* Spelaren ligger fast över flikraden i mobilen. */}
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] z-40 border-t border-[var(--usha-border)] bg-[var(--usha-card)]/95 backdrop-blur md:bottom-0">
        <div className="mx-auto max-w-3xl px-4 py-3">
          <button
            type="button"
            aria-label={t("seek")}
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
              seek(segmentAtOffset(segments, fraction * doc.text.length));
            }}
            className="mb-2 block h-2 w-full overflow-hidden rounded-full bg-[var(--usha-border)]"
          >
            <span
              className="block h-full rounded-full bg-[var(--usha-gold)] transition-[width]"
              style={{ width: `${Math.round(ratio * 100)}%` }}
            />
          </button>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <button
                aria-label={t("previousSentence")}
                onClick={() => skip(-1)}
                className="rounded-full p-2 text-[var(--usha-white)] transition hover:bg-[var(--usha-card-hover)]"
              >
                <SkipBack size={20} />
              </button>
              <button
                aria-label={status === "playing" ? t("pause") : t("play")}
                onClick={toggle}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--usha-gold)] text-[var(--usha-black)] transition hover:opacity-90"
              >
                {status === "playing" ? <Pause size={22} /> : <Play size={22} className="ml-0.5" />}
              </button>
              <button
                aria-label={t("nextSentence")}
                onClick={() => skip(1)}
                className="rounded-full p-2 text-[var(--usha-white)] transition hover:bg-[var(--usha-card-hover)]"
              >
                <SkipForward size={20} />
              </button>
              {status !== "idle" && (
                <button
                  aria-label={t("stop")}
                  onClick={stop}
                  className="rounded-full p-2 text-[var(--usha-muted)] transition hover:text-[var(--usha-white)]"
                >
                  <Square size={18} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="hidden text-xs text-[var(--usha-muted)] sm:inline">
                {t("remaining", { duration: formatDuration(remaining) })}
              </span>
              <label className="flex items-center gap-1 text-xs text-[var(--usha-muted)]">
                <Gauge size={14} aria-hidden />
                <span className="sr-only">{t("speed")}</span>
                <select
                  value={RATES.includes(speech.rate) ? speech.rate : 1}
                  onChange={(e) => setRate(Number(e.target.value))}
                  className="rounded-lg border border-[var(--usha-border)] bg-[var(--usha-black)] px-2 py-1 text-xs text-[var(--usha-white)]"
                >
                  {RATES.filter((r) => r >= MIN_RATE && r <= MAX_RATE).map((r) => (
                    <option key={r} value={r}>
                      {r}×
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1 text-xs text-[var(--usha-muted)]">
                <Volume2 size={14} aria-hidden />
                <span className="sr-only">{t("voice")}</span>
                <select
                  value={speech.voiceUri ?? ""}
                  onChange={(e) => setVoiceUri(e.target.value || null)}
                  className="max-w-[8rem] rounded-lg border border-[var(--usha-border)] bg-[var(--usha-black)] px-2 py-1 text-xs text-[var(--usha-white)] sm:max-w-[12rem]"
                >
                  <option value="">{t("defaultVoice")}</option>
                  {speech.voices.map((v) => (
                    <option key={v.uri} value={v.uri}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {speech.voices.length === 0 && (
            <p className="mt-2 flex items-center gap-2 text-xs text-[var(--usha-muted)]">
              <Loader2 size={12} className="animate-spin" /> {t("loadingVoices")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
