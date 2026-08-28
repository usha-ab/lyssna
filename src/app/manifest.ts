import type { MetadataRoute } from "next";

// Appen är gjord för att installeras på hemskärmen: standalone-läge, egen
// ikon, och start direkt i läsvyn.
//
// share_target lägger appen i Androids dela-meny. Det är skillnaden mellan
// att kopiera en text, byta app, klistra in och trycka spela — och att bara
// trycka Dela → Lyssna. Fältet saknas i Nexts typ för manifestet, därav
// utvidgningen nedan; webbläsaren läser det ändå.
type ManifestWithShareTarget = MetadataRoute.Manifest & {
  share_target: {
    action: string;
    method: "POST";
    enctype: "multipart/form-data";
    params: { title: string; text: string; url: string };
  };
};

export default function manifest(): ManifestWithShareTarget {
  return {
    name: "Lyssna",
    short_name: "Lyssna",
    description: "Få texter, PDF:er och böcker upplästa. Byggd för headset.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0a0b",
    theme_color: "#c8a445",
    share_target: {
      action: "/dela",
      method: "POST",
      enctype: "multipart/form-data",
      params: { title: "title", text: "text", url: "url" },
    },
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
