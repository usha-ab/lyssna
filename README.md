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

Appen ligger på Vercel och bygger om vid varje push till `main`. Produktion:
<https://lyssna-nu.vercel.app> (och `lyssna.usha.se` när domänen är pekad).

Miljövariabler (Production och Preview):

| Variabel | Värde |
| :-- | :-- |
| `NEXT_PUBLIC_SUPABASE_URL` | Usha Platforms Supabase-projekt |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Projektets **publishable**-nyckel (`sb_publishable_…`) |
| `LISTEN_ALLOWED_USER_IDS` | user-id som får använda appen, kommaseparerat |

Tre fallgropar, alla dyrköpta:

- **Den gamla JWT-formade `anon`-nyckeln är avstängd i projektet.** Använder du
  en sådan går det inte att logga in, utan att felet säger varför. Det ska vara
  `sb_publishable_…`.
- **`NEXT_PUBLIC_`-variabler bakas in när bygget körs**, inte när appen kör.
  Läggs de till efteråt ser allt rätt ut i Vercels gränssnitt medan appen ändå
  saknar dem — bygg om.
- **Utan `LISTEN_ALLOWED_USER_IDS` *och* utan `SUPABASE_SERVICE_ROLE_KEY`
  släpps ingen in**, inte ens en admin: admin-uppslaget kräver service-nyckeln.
  Att sätta id-listan är enklare och betyder en hemlighet mindre att sprida.

Kopplar du appen till ett Vercel-projekt: hoppa över Supabase-integrationen
under *Optional Integrations*. Den provisionerar ett nytt Supabase-projekt och
skriver över variablerna ovan.

Sista steget ligger i Supabase: lägg till `https://<domänen>/callback` under
Authentication → URL Configuration → Redirect URLs. Lösenordsinloggning
fungerar utan det, men inloggningslänkar i mejl gör det inte.

## Utveckling

`main` är skyddad av ett ruleset: ändringar går via pull request, och
`.github/workflows/ci.yml` kör lint, tester och bygge på varje sådan. Grenen
raderas automatiskt när PR:en mergats.

```bash
npm run lint     # ESLint
npm test         # 121 enhetstester (vitest)
npm run build    # samma bygge som Vercel kör
```

Testerna täcker de delar där felen faktiskt bor: segmenteringen av text,
sammanslagningen vid synk, EPUB-uppackningen, hopsättningen av PDF-fragment
och SSRF-grinden. Uppspelningen och gränssnittet är inte enhetstestade — de
kräver en webbläsare med talsyntes.

## Vad appen inte gör

- **Rösterna är webbläsarens egna** (Google eller Samsung TTS på Android). Bra
  nog för att lyssna länge, men inte neurala molnröster. En molnröst kopplas in
  som ett alternativ i `use-speech.ts`.
- **Ingen diktering ännu.** Tanken är att den ska in här som ett andra läge,
  inte som en egen app.
- **Ingen bubbla över andra appar.** Det kräver systemöverlägg och en
  tangentbordstjänst i Android — alltså en native-build, inte en webbapp.
- **Inskannade PDF:er** har inget textlager och kan inte läsas upp utan OCR.
