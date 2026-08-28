import type { MetadataRoute } from "next";

// Appen är gjord för att installeras på hemskärmen: standalone-läge, egen
// ikon, och start direkt i läsvyn.
export default function manifest(): MetadataRoute.Manifest {
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
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
