# Lyssna

En uppläsare för texter, PDF:er och böcker. Klistra in en text, ladda upp en
fil eller importera en artikel via länk — och lyssna, med meningen markerad
och ordet fetstilat i takt med rösten.

Byggd för att användas med headset: uppspelningen styrs från låsskärmen och
notisen, och fortsätter när skärmen är släckt.

Appen bröts ut ur Usha Platform (`usha-ab/creators-platform`, `/app/lyssna`)
för att leva sitt eget liv. Den delar fortfarande konto och databas med
plattformen — man loggar in med sitt Usha-konto och biblioteket är samma
tabell — men släpps, designas och utvecklas för sig.

## Kom igång

```bash
npm install
cp .env.example .env.local   # fyll i värdena
npm run dev                  # http://localhost:3000
```

## Så hänger det ihop

| Del | Vad den gör |
| :-- | :-- |
| `src/lib/tts/segment.ts` | Delar text i talbara meningar som bär sina teckenpositioner i originalet. Allt annat — markeringen, hoppen, läspositionen — uttrycks i dem. |
| `src/lib/tts/use-speech.ts` | Talar en mening i taget mot webbläsarens talsyntes. En i taget, för långa utterances klipps i Chrome och boundary-events slutar komma. |
| `src/lib/tts/use-media-session.ts` | Låsskärm, notis och headsetknappar, plus ett nästan tyst spår som håller sidan vaken när skärmen släcks. |
| `src/lib/tts/epub.ts` | Läser EPUB utan beroende: arkivet packas upp med `DecompressionStream`, kapitlen läses i spine-ordning. |
| `src/lib/tts/pdf.ts` | Läser PDF med `pdfjs-dist`. Måste vara det **minifierade legacy-bygget** — standardbygget kraschar under Next. |
| `src/lib/tts/sync.ts` | Sammanslagningen mellan enheter: senaste ändringen vinner per dokument, gravstenar för raderingar. |
| `src/lib/tts/library.ts` | Den lokala kopian i `localStorage`, så appen öppnar direkt och fungerar offline. |
| `src/lib/access.ts` | Vem som får använda appen (se `LISTEN_ALLOWED_USER_IDS`). |

## Databasen

Tabellen `listen_documents` ligger i Usha Platforms Supabase-projekt, med RLS
per ägare. Den skapades av migrationen
`supabase/migrations/20260828_add_listen_documents.sql` i plattformens repo och
behöver inte köras igen här.

## Deploy

1. Skapa ett Vercel-projekt mot det här repot (Next.js, inga särskilda inställningar).
2. Lägg in miljövariablerna ur `.env.example`.
3. Peka domänen (t.ex. `lyssna.usha.se`) på projektet.
4. Lägg till `https://<domänen>/callback` under Supabase → Authentication →
   URL Configuration → Redirect URLs, annars går inloggningslänkar inte att
   lösa in.

## Vad appen inte gör

- **Rösterna är webbläsarens egna** (Google eller Samsung TTS på Android). Bra
  nog för att lyssna länge, men inte neurala molnröster. En molnröst kopplas in
  som ett alternativ i `use-speech.ts`.
- **Ingen diktering ännu.** Tanken är att den ska in här som ett andra läge,
  inte som en egen app.
- **Ingen bubbla över andra appar.** Det kräver systemöverlägg och en
  tangentbordstjänst i Android — alltså en native-build, inte en webbapp.
- **Inskannade PDF:er** har inget textlager och kan inte läsas upp utan OCR.
