# CLAUDE.md

Vägledning för Claude Code (claude.ai/code) i det här repot.

## Kommandon

- `npm run dev` — utvecklingsserver (port 3000)
- `npm run build` — produktionsbygge, samma som Vercel kör
- `npm run lint` — ESLint
- `npm test` — enhetstester (Vitest), `npm run test:watch` för bevakning

CI kör alla tre på varje pull request. `main` är skyddad av ett ruleset:
ändringar går via PR, aldrig med en direkt push.

## Vad appen är

En uppläsare: text in — inklistrad, uppladdad som PDF/EPUB/textfil, eller
hämtad från en artikel — och uppläst med meningen markerad och ordet fetstilat
i takt med rösten. Byggd för headset, med låsskärmskontroller.

Utbruten ur `usha-ab/creators-platform` (`/app/lyssna`), men delar konto och
databas med plattformen: man loggar in med sitt Usha-konto och biblioteket är
samma tabell, `listen_documents`. Rättningar i `src/lib/tts/` kan därför
flyttas mellan repona — filerna är avsiktligt identiska.

## Arkitektur

### Uppläsningen

`src/lib/tts/segment.ts` delar text i meningar som **bär sina teckenpositioner
i originalet**. Allt annat uttrycks i dem: markeringen i läsvyn, klick-för-att-
hoppa, och den sparade läspositionen. Svenska förkortningar (`t.ex.`, `bl.a.`),
decimaltal och initialer bryter inte en mening; för långa meningar delas vid
komma.

`use-speech.ts` talar **ett segment i taget** mot `window.speechSynthesis` och
startar nästa när det föregående tar slut. Skälet är tre: Chrome klipper långa
utterances, boundary-events blir opålitliga efter några tusen tecken, och utan
meningsgränser går det varken att hoppa en mening bakåt eller visa var
läsningen är. En generationsräknare gör att `cancel()`:s eftersläpande `onend`
inte startar två röster samtidigt.

`use-media-session.ts` ger låsskärm och notis, och loopar ett nästan tyst spår
så länge uppläsningen pågår. Utan ett spår som spelar är talsyntesen inte
"media" för webbläsaren: ingen notis, och Android stryper fliken när skärmen
släcks. Det är en förbättring, inte en garanti — helt pålitlig
bakgrundsuppspelning kräver riktigt ljud (molnröst i `<audio>`).

### Filformaten

`epub.ts` läser EPUB **utan beroende**: arkivet är en ZIP, centralkatalogen
läses för hand och `DecompressionStream("deflate-raw")` packar upp. Kapitlen
läses i spine-ordning, inte filordning.

`pdf.ts` använder `pdfjs-dist`, dynamiskt importerat. **Det måste vara det
minifierade legacy-bygget** (`pdfjs-dist/legacy/build/pdf.min.mjs`) —
standardbygget kraschar när Next paketerar det ("Object.defineProperty called
on non-object"). Typerna kommer via `src/types/pdfjs-min.d.ts`. PDF lagrar
positionerade fragment, inte meningar: de grupperas till rader efter y-läge och
till stycken efter radavstånd.

### Biblioteket

Två lager. `library.ts` är den lokala kopian i `localStorage` — vyn ska öppna
direkt och fungera utan nät. `listen_documents` i Postgres är den delade
sanningen, med RLS per ägare. `sync.ts` är den rena sammanslagningen (senaste
ändringen vinner per dokument, gravstenar för raderingar) och `client-sync.ts`
kör den mot API-rutterna. Texterna hämtas **per dokument när det öppnas** — ett
bibliotek är inget man laddar hem i sin helhet vid varje sidladdning.

### Åtkomst

`src/lib/access.ts` avgör vem som får använda appen: `LISTEN_ALLOWED_USER_IDS`
(id-lista, eller `*` för alla inloggade), annars `profiles.is_admin` — vilket
kräver service-nyckeln. Grinden sitter i sidan **och** i varje API-rutt; en dold
sida är inte en stängd sida.

`POST /api/extract` hämtar artiklar på servern eftersom CORS stoppar
webbläsaren. `url-guard.ts` kontrollerar adressen före hämtningen, vid varje
omdirigering, och mot DNS-svaret — ett publikt värdnamn kan peka på 10.0.0.1.

## Texter

Ett språk (svenska), en fil: `src/lib/strings.ts`. `useStrings()` har samma
anropsform som next-intls `useTranslations`, så vyerna ser ut som i
plattformen. Inget i18n-lager — appen har en användare.

## Vad som inte finns

Ingen diktering (tanken är att den ska bli ett andra läge här, inte en egen
app), inga neurala röster (webbläsarens egna används), och ingen OCR för
inskannade PDF:er.
