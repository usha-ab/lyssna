// pdfjs-dist levererar typer för sina o-minifierade bygg, men appen importerar
// det minifierade legacy-bygget: standardbygget kraschar när Next paketerar
// det ("Object.defineProperty called on non-object"). Samma API, bara komprimerat.
declare module "pdfjs-dist/legacy/build/pdf.min.mjs" {
  export * from "pdfjs-dist/legacy/build/pdf.mjs";
}
