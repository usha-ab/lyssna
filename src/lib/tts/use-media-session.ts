"use client";

// Låsskärmskontroller och uppläsning när skärmen är släckt.
//
// Två problem ska lösas, och de hänger ihop:
//
// 1. Talsyntesen är inte "media" för webbläsaren. Utan ett ljudspår som spelar
//    visas ingen notis, låsskärmen får inga knappar, och Android behandlar
//    fliken som vilken bakgrundsflik som helst — och strypar den. Därför
//    spelas ett tyst spår i loop så länge uppläsningen pågår. Det håller
//    ljudfokus, gör notisen möjlig och håller sidan vaken.
//
// 2. Knapparna i notisen måste styra uppläsningen. Det är vad
//    MediaSession-handlarna nedan gör.
//
// Vad det INTE löser: att Android ändå kan pausa talsyntesen i djup viloläge
// på vissa enheter. Den helt pålitliga vägen är att generera riktigt ljud
// (molnröst) och spela det i <audio> — då är uppläsningen media på riktigt.

import { useEffect, useRef } from "react";

/**
 * Ett kort, nästan tyst spår att loopa.
 *
 * Digital tystnad optimeras bort av vissa webbläsare — spåret måste ha ett
 * innehåll för att räknas som uppspelning — så vågformen ligger på lägsta
 * möjliga nivå i stället för på noll. Det är ohörbart men inte "ingenting".
 */
function createSilentTrackUrl(): string {
  const sampleRate = 8000;
  const samples = sampleRate; // en sekund, loopas
  const buffer = new ArrayBuffer(44 + samples);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true); // 8 bitar
  ascii(36, "data");
  view.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) {
    // 8-bitars PCM har tystnaden på 128. ±1 är en LSB — ohörbart.
    view.setUint8(44 + i, 128 + (i % 2));
  }

  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

export interface MediaSessionOptions {
  /** Ett dokument är öppet. Är det falskt rivs sessionen ner. */
  active: boolean;
  playing: boolean;
  title: string;
  /** Raden under titeln i notisen — här meningen som läses. */
  subtitle?: string;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onStop: () => void;
}

type Handler = [MediaSessionAction, (() => void) | null];

export function useMediaSession(options: MediaSessionOptions) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  // Handlarna byts vid varje rendering; sessionen ska peka på de senaste utan
  // att registreras om varje gång.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Ljudspåret följer uppspelningen.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!options.active || !options.playing) {
      audioRef.current?.pause();
      return;
    }

    if (!audioRef.current) {
      urlRef.current = createSilentTrackUrl();
      const audio = new Audio(urlRef.current);
      audio.loop = true;
      // Ett spår som räknas som media måste ha volym. Innehållet är ohörbart.
      audio.volume = 1;
      audioRef.current = audio;
    }
    // Spelningen startas alltid i spåren av ett klick (play-knappen), så
    // autospelspolicyn tillåter den. Misslyckas den ändå är konsekvensen att
    // bakgrundsuppspelningen uteblir — inte att uppläsningen slutar fungera.
    void audioRef.current.play().catch(() => {});
  }, [options.active, options.playing]);

  // Metadata och knappar i notisen.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    if (!options.active) {
      session.metadata = null;
      session.playbackState = "none";
      return;
    }

    session.metadata = new MediaMetadata({
      title: options.title,
      artist: options.subtitle || "Usha Lyssna",
      album: "Usha Lyssna",
      artwork: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    });
    session.playbackState = options.playing ? "playing" : "paused";
  }, [options.active, options.playing, options.title, options.subtitle]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    const handlers: Handler[] = [
      ["play", () => optionsRef.current.onPlay()],
      ["pause", () => optionsRef.current.onPause()],
      ["stop", () => optionsRef.current.onStop()],
      ["previoustrack", () => optionsRef.current.onPrevious()],
      ["nexttrack", () => optionsRef.current.onNext()],
      // Hörlurarnas spola-knappar hoppar mening, som fram och bak.
      ["seekbackward", () => optionsRef.current.onPrevious()],
      ["seekforward", () => optionsRef.current.onNext()],
    ];

    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Alla webbläsare stöder inte alla handlingar. Den som saknas visas
        // helt enkelt inte i notisen.
      }
    }

    return () => {
      for (const [action] of handlers) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // Se ovan.
        }
      }
    };
  }, []);

  // Städning när läsvyn lämnas: spåret stoppas och notisen tas bort.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
      if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = "none";
      }
    };
  }, []);
}
