"use client";

// Uppspelningen mot webbläsarens talsyntes.
//
// Hela texten skickas inte in i en enda utterance. Chrome klipper långa
// utterances, boundary-events slutar komma efter en stund, och utan
// meningsgränser går det varken att hoppa en mening bakåt eller visa var
// läsningen är. I stället talas ett segment i taget och nästa startas när
// det föregående tar slut.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { wordAt, type Segment } from "./segment";

export type SpeechStatus = "idle" | "playing" | "paused";

export interface SpeechVoice {
  uri: string;
  name: string;
  lang: string;
  localService: boolean;
}

/** Ordet som läses just nu, i originaltextens koordinater. */
export interface WordRange {
  start: number;
  end: number;
}

export const MIN_RATE = 0.5;
export const MAX_RATE = 3;

interface UseSpeechOptions {
  segments: Segment[];
  /** Anropas när uppläsningen går in i ett nytt segment — används för att spara läspositionen. */
  onSegmentChange?: (segment: Segment) => void;
  /** Anropas när sista segmentet är uppläst. */
  onFinish?: () => void;
}

/**
 * Chrome pausar talsyntesen av sig själv efter ungefär 15 sekunder. En
 * pause/resume-puls håller den igång. Safari får inte samma behandling — där
 * orsakar pulsen hack i uppläsningen i stället.
 */
function needsResumePulse(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Chrome|Chromium|Edg\//.test(navigator.userAgent);
}

export function useSpeech({ segments, onSegmentChange, onFinish }: UseSpeechOptions) {
  const [supported, setSupported] = useState(false);
  const [voices, setVoices] = useState<SpeechVoice[]>([]);
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [word, setWord] = useState<WordRange | null>(null);
  const [rate, setRateState] = useState(1);
  const [voiceUri, setVoiceUriState] = useState<string | null>(null);

  // Uppspelningen läser de här i sina callbacks; state hade fastnat i den
  // stängning som gällde när utterancen skapades.
  const segmentsRef = useRef(segments);
  const rateRef = useRef(rate);
  const voiceRef = useRef(voiceUri);
  const statusRef = useRef(status);
  const indexRef = useRef(0);
  /**
   * cancel() utlöser onend på den pågående utterancen. Utan en räknare som
   * ökas vid varje ny start skulle det gamla onend-anropet starta nästa
   * segment och två röster tala samtidigt.
   */
  const generationRef = useRef(0);
  const onSegmentChangeRef = useRef(onSegmentChange);
  const onFinishRef = useRef(onFinish);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);
  useEffect(() => {
    onSegmentChangeRef.current = onSegmentChange;
    onFinishRef.current = onFinish;
  }, [onSegmentChange, onFinish]);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Röstlistan fylls asynkront i Chrome — den är tom vid första anropet.
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    setSupported(true);
    const synth = window.speechSynthesis;
    const read = () => {
      const list = synth.getVoices().map((v) => ({
        uri: v.voiceURI,
        name: v.name,
        lang: v.lang,
        localService: v.localService,
      }));
      if (list.length > 0) setVoices(list);
    };
    read();
    synth.addEventListener("voiceschanged", read);
    return () => synth.removeEventListener("voiceschanged", read);
  }, []);

  const stop = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    generationRef.current++;
    window.speechSynthesis.cancel();
    setStatus("idle");
    setWord(null);
  }, []);

  // Talsyntesen lever i webbläsaren, inte i React. Utan den här städningen
  // fortsätter rösten tala efter att sidan bytts.
  useEffect(() => stop, [stop]);

  const speakFrom = useCallback((index: number) => {
    const synth = window.speechSynthesis;
    const list = segmentsRef.current;
    if (index >= list.length) {
      setStatus("idle");
      setWord(null);
      onFinishRef.current?.();
      return;
    }

    const generation = ++generationRef.current;
    synth.cancel();

    const segment = list[index];
    indexRef.current = index;
    setSegmentIndex(index);
    setWord(null);
    onSegmentChangeRef.current?.(segment);

    const utterance = new SpeechSynthesisUtterance(segment.text);
    utterance.rate = rateRef.current;
    const voice = synth.getVoices().find((v) => v.voiceURI === voiceRef.current);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }

    utterance.onboundary = (event) => {
      if (generation !== generationRef.current) return;
      if (event.name && event.name !== "word") return;
      const range = wordAt(segment.text, event.charIndex);
      if (range.end <= range.start) return;
      setWord({ start: segment.start + range.start, end: segment.start + range.end });
    };

    utterance.onend = () => {
      if (generation !== generationRef.current) return;
      speakFrom(index + 1);
    };

    utterance.onerror = (event) => {
      if (generation !== generationRef.current) return;
      // "interrupted"/"canceled" är vår egen cancel() och inget att larma om.
      if (event.error === "interrupted" || event.error === "canceled") return;
      setStatus("idle");
      setWord(null);
    };

    setStatus("playing");
    synth.speak(utterance);
  }, []);

  const play = useCallback(
    (index?: number) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const synth = window.speechSynthesis;
      if (index === undefined && statusRef.current === "paused" && synth.paused) {
        synth.resume();
        setStatus("playing");
        return;
      }
      speakFrom(index ?? indexRef.current);
    },
    [speakFrom]
  );

  const pause = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.pause();
    setStatus("paused");
  }, []);

  const toggle = useCallback(() => {
    if (statusRef.current === "playing") pause();
    else play();
  }, [pause, play]);

  /** Hoppar ett antal segment i endera riktningen. */
  const skip = useCallback(
    (delta: number) => {
      const next = Math.max(
        0,
        Math.min(indexRef.current + delta, Math.max(segmentsRef.current.length - 1, 0))
      );
      if (statusRef.current === "playing" || statusRef.current === "paused") {
        speakFrom(next);
      } else {
        indexRef.current = next;
        setSegmentIndex(next);
        setWord(null);
      }
    },
    [speakFrom]
  );

  /** Hoppar till ett segment — används när någon klickar i texten. */
  const seek = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, Math.max(segmentsRef.current.length - 1, 0)));
      if (statusRef.current === "playing") {
        speakFrom(clamped);
      } else {
        indexRef.current = clamped;
        setSegmentIndex(clamped);
        setWord(null);
      }
    },
    [speakFrom]
  );

  /**
   * Hastighet och röst går inte att ändra på en utterance som redan talar.
   * Pågår uppläsningen startas därför meningen om med den nya inställningen —
   * en omtagen mening är mindre störande än att reglaget inte gör något.
   */
  const setRate = useCallback(
    (next: number) => {
      const clamped = Math.min(MAX_RATE, Math.max(MIN_RATE, Number(next.toFixed(2))));
      rateRef.current = clamped;
      setRateState(clamped);
      if (statusRef.current === "playing") speakFrom(indexRef.current);
    },
    [speakFrom]
  );

  const setVoiceUri = useCallback(
    (next: string | null) => {
      voiceRef.current = next;
      setVoiceUriState(next);
      if (statusRef.current === "playing") speakFrom(indexRef.current);
    },
    [speakFrom]
  );

  // Chromes 15-sekunderstimeout.
  useEffect(() => {
    if (status !== "playing" || !needsResumePulse()) return;
    const id = window.setInterval(() => {
      const synth = window.speechSynthesis;
      if (synth.speaking && !synth.paused) {
        synth.pause();
        synth.resume();
      }
    }, 10_000);
    return () => window.clearInterval(id);
  }, [status]);

  /** Röster sorterade med appens språk först — en svensk text ska inte läsas av en engelsk röst. */
  const sortedVoices = useMemo(() => {
    const preferred = typeof document !== "undefined" ? document.documentElement.lang || "sv" : "sv";
    const score = (v: SpeechVoice) => {
      if (v.lang.toLowerCase().startsWith(preferred.toLowerCase().slice(0, 2))) return 0;
      if (v.lang.toLowerCase().startsWith("en")) return 1;
      return 2;
    };
    return [...voices].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
  }, [voices]);

  return {
    supported,
    voices: sortedVoices,
    status,
    segmentIndex,
    word,
    rate,
    voiceUri,
    play,
    pause,
    toggle,
    stop,
    skip,
    seek,
    setRate,
    setVoiceUri,
  };
}
