import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lyssna",
  description: "Få texter, PDF:er och böcker upplästa. Byggd för headset.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "Lyssna", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#c8a445",
  // Uppläsaren har inget att zooma in på, och zoom i farten gör bara att man
  // tappar raden man följer.
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <body>{children}</body>
    </html>
  );
}
