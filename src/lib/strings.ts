// Appens texter. Ett språk, en fil — ingen anledning till ett i18n-lager
// i ett personligt verktyg. Platshållare skrivs {så här}.

const STRINGS: Record<string, string> = {
  "title": "Lyssna",
  "subtitle": "Klistra in en text, ladda upp en fil eller importera en artikel — och få den uppläst.",
  "back": "Tillbaka",
  "meta": "{words} ord · ca {duration}",
  "wordCount": "{words} ord · ca {duration}",
  "progress": "{percent}% uppläst",
  "remaining": "{duration} kvar",
  "smallerText": "Mindre text",
  "largerText": "Större text",
  "longDocumentNotice": "Långt dokument — texten visas i ett fönster runt läspositionen.",
  "seek": "Hoppa i texten",
  "play": "Spela upp",
  "pause": "Pausa",
  "stop": "Stoppa",
  "previousSentence": "Föregående mening",
  "nextSentence": "Nästa mening",
  "speed": "Hastighet",
  "voice": "Röst",
  "defaultVoice": "Systemets röst",
  "loadingVoices": "Hämtar röster …",
  "unsupported": "Din webbläsare kan inte läsa upp text. Prova Chrome, Edge eller Safari.",
  "tabPaste": "Klistra in",
  "tabFile": "Fil",
  "tabUrl": "Länk",
  "pastePlaceholder": "Klistra in texten du vill lyssna på …",
  "listenAction": "Lyssna",
  "importAction": "Importera",
  "fileCta": "Välj en fil",
  "fileHint": "PDF, EPUB, TXT, MD, CSV eller JSON",
  "urlHint": "Hämtar artikelns text från sidan.",
  "libraryHeading": "Mitt bibliotek",
  "libraryEmpty": "Inga texter sparade än. Lägg till en ovan.",
  "loading": "Laddar …",
  "delete": "Ta bort",
  "untitled": "Namnlöst dokument",
  "errorEmpty": "Texten är tom.",
  "errorImport": "Sidan gick inte att importera.",
  "errorFileSize": "Filen är för stor. Max 2 MB.",
  "errorFileRead": "Filen gick inte att läsa.",
  "deleteConfirm": "Ta bort ”{title}”? Texten går inte att få tillbaka.",
  "importing": "Hämtar sidan …",
  "reading": "Läser filen …",
  "readingPage": "Läser sida {page} av {total} …",
  "syncing": "Synkar …",
  "syncOk": "Synkat",
  "syncOffline": "Offline – försök igen",
  "syncLocalOnly": "Bara på den här enheten",
  "privacySynced": "Texterna sparas på ditt konto och följer med till dina andra enheter. Bara du kan läsa dem.",
  "privacyLocal": "Du är utloggad, så texterna ligger bara i den här webbläsaren. Logga in för att få dem på dina andra enheter.",
  "errorFetchText": "Texten gick inte att hämta. Kontrollera nätet och försök igen.",
  "errorPdfUnreadable": "Filen gick inte att öppna som PDF.",
  "errorPdfNoText": "Hittade ingen text i PDF:en. Är den inskannad behöver den textigenkänning först.",
  "errorEpubNotArchive": "Filen ser inte ut som en EPUB.",
  "errorEpubBroken": "EPUB-filen är skadad och gick inte att läsa.",
  "errorEpubCompression": "EPUB-filen använder en komprimering vi inte kan läsa.",
  "errorEpubNoText": "Hittade ingen läsbar text i boken.",
};

/** Slår upp en text och fyller i platshållare. Saknad nyckel ger nyckeln
 *  tillbaka — synligt i gränssnittet, men aldrig en krasch. */
export function t(key: string, params?: Record<string, string | number>): string {
  const value = STRINGS[key];
  if (value === undefined) return key;
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  );
}

/** Samma anropsform som next-intls useTranslations, så vyerna ser likadana ut. */
export function useStrings() {
  return t;
}
