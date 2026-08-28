import { describe, it, expect } from "vitest";
import { htmlToText, extractTitle, decodeEntities } from "../html-text";

describe("htmlToText", () => {
  it("plockar bort script, style och navigation", () => {
    const html = `<body><nav>Meny Hem</nav><script>var a = "text";</script>
      <style>.x{color:red}</style><p>Verkligt innehåll.</p><footer>Kontakt</footer></body>`;
    const text = htmlToText(html);
    expect(text).toBe("Verkligt innehåll.");
  });

  it("föredrar artikelkroppen när sidan har en", () => {
    const filler = "Brödtext som gör artikeln lång nog att räknas. ".repeat(20);
    const html = `<body><div>Sidopanel</div><article><p>${filler}</p></article></body>`;
    expect(htmlToText(html)).not.toContain("Sidopanel");
  });

  it("gör blockelement till radbrytningar", () => {
    const text = htmlToText("<body><h1>Rubrik</h1><p>Stycke ett.</p><p>Stycke två.</p></body>");
    expect(text.split("\n").filter(Boolean)).toEqual(["Rubrik", "Stycke ett.", "Stycke två."]);
  });

  it("behåller text i inline-taggar utan att klistra ihop orden", () => {
    expect(htmlToText("<p>Ett <b>fetstilt</b> ord.</p>")).toBe("Ett fetstilt ord.");
  });

  it("avkodar entiteter", () => {
    expect(htmlToText("<p>Caf&eacute; &amp; bar &#8212; &#x00e5;ka</p>")).toBe("Café & bar — åka");
  });

  it("tar bort HTML-kommentarer", () => {
    expect(htmlToText("<p>Synlig.<!-- <p>Dold.</p> --></p>")).toBe("Synlig.");
  });

  it("klarar ostängda taggar utan att tappa texten", () => {
    expect(htmlToText("<body><p>Ett stycke<br>med brytning</body>")).toContain("med brytning");
  });

  it("komprimerar långa serier av blankrader", () => {
    const text = htmlToText("<p>Ett.</p><div></div><div></div><div></div><p>Två.</p>");
    expect(text).toBe("Ett.\n\nTvå.");
  });
});

describe("extractTitle", () => {
  it("föredrar og:title", () => {
    const html = `<head><meta property="og:title" content="Delad titel"><title>Sidtitel</title></head>`;
    expect(extractTitle(html)).toBe("Delad titel");
  });

  it("faller tillbaka på h1 och sedan title", () => {
    expect(extractTitle("<h1>Rubriken <span>här</span></h1>")).toBe("Rubriken här");
    expect(extractTitle("<title>Bara sidtitel</title>")).toBe("Bara sidtitel");
  });

  it("ger null när titel saknas", () => {
    expect(extractTitle("<p>Text</p>")).toBeNull();
  });
});

describe("decodeEntities", () => {
  it("lämnar okända entiteter orörda", () => {
    expect(decodeEntities("&okand; kvar")).toBe("&okand; kvar");
  });

  it("lämnar ogiltiga teckenkoder orörda", () => {
    expect(decodeEntities("&#999999999;")).toBe("&#999999999;");
  });
});
