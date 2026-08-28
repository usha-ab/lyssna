import { describe, it, expect } from "vitest";
import {
  splitSentences,
  segmentAtOffset,
  wordAt,
  countWords,
  estimateSeconds,
  formatDuration,
} from "../segment";

describe("splitSentences", () => {
  it("delar på meningsslut", () => {
    const text = "Hej där. Hur mår du? Bra!";
    expect(splitSentences(text).map((s) => s.text)).toEqual([
      "Hej där.",
      "Hur mår du?",
      "Bra!",
    ]);
  });

  it("behåller positionerna i originaltexten", () => {
    const text = "Ett. Två.";
    const [first, second] = splitSentences(text);
    expect(text.slice(first.start, first.end)).toBe("Ett.");
    expect(text.slice(second.start, second.end)).toBe("Två.");
  });

  it("bryter inte i svenska förkortningar", () => {
    const text = "Vi säljer bl.a. biljetter, t.ex. till kurser.";
    expect(splitSentences(text)).toHaveLength(1);
  });

  it("bryter inte i decimaltal", () => {
    expect(splitSentences("Priset är 199.50 kronor totalt.")).toHaveLength(1);
  });

  it("bryter inte vid initialer", () => {
    expect(splitSentences("Boken skrevs av J. Andersson i fjol.")).toHaveLength(1);
  });

  it("håller ihop avslutande citattecken med meningen", () => {
    const text = 'Hon sa "kom nu." Sedan gick vi.';
    const segments = splitSentences(text);
    expect(segments.map((s) => s.text)).toEqual(['Hon sa "kom nu."', "Sedan gick vi."]);
  });

  it("räknar flera avslutningstecken som ett slut", () => {
    expect(splitSentences("Va?! Det var oväntat.").map((s) => s.text)).toEqual([
      "Va?!",
      "Det var oväntat.",
    ]);
  });

  it("bryter på radbrytning även utan skiljetecken", () => {
    const segments = splitSentences("Rubrik utan punkt\nBrödtext här.");
    expect(segments.map((s) => s.text)).toEqual(["Rubrik utan punkt", "Brödtext här."]);
  });

  it("delar meningar som är för långa för talsyntesen", () => {
    // En mening på ~600 tecken utan punkt måste ändå bli talbara bitar.
    const long = Array.from({ length: 60 }, (_, i) => `ord${i} och`).join(", ") + ".";
    const segments = splitSentences(long);
    expect(segments.length).toBeGreaterThan(1);
    for (const s of segments) expect(s.text.length).toBeLessThanOrEqual(280);
    // Ingen text får försvinna i delningen.
    expect(segments.map((s) => s.text).join(" ").replace(/\s+/g, " ")).toBe(
      long.replace(/\s+/g, " ")
    );
  });

  it("ger inga tomma segment för blankrader", () => {
    const segments = splitSentences("Ett.\n\n\nTvå.");
    expect(segments.map((s) => s.text)).toEqual(["Ett.", "Två."]);
  });

  it("ger tom lista för tom text", () => {
    expect(splitSentences("   \n  ")).toEqual([]);
  });

  it("numrerar segmenten löpande", () => {
    const segments = splitSentences("Ett. Två. Tre.");
    expect(segments.map((s) => s.index)).toEqual([0, 1, 2]);
  });
});

describe("segmentAtOffset", () => {
  const segments = splitSentences("Ett. Två. Tre.");

  it("hittar segmentet som täcker positionen", () => {
    expect(segmentAtOffset(segments, 0)).toBe(0);
    expect(segmentAtOffset(segments, 6)).toBe(1);
  });

  it("klampar till sista segmentet bortom slutet", () => {
    expect(segmentAtOffset(segments, 9999)).toBe(2);
  });

  it("klarar tomt dokument", () => {
    expect(segmentAtOffset([], 5)).toBe(0);
  });
});

describe("wordAt", () => {
  it("expanderar till hela ordet", () => {
    const text = "Hej på dig";
    expect(wordAt(text, 5)).toEqual({ start: 4, end: 6 });
  });

  it("håller ihop bindestreck och apostrof", () => {
    const text = "e-post och it's";
    expect(text.slice(...Object.values(wordAt(text, 0)) as [number, number])).toBe("e-post");
  });

  it("ger en teckenbredd för skiljetecken", () => {
    expect(wordAt("Hej.", 3)).toEqual({ start: 3, end: 4 });
  });

  it("klarar index utanför texten", () => {
    expect(wordAt("Hej", 99)).toEqual({ start: 0, end: 0 });
  });
});

describe("countWords", () => {
  it("räknar ord utan att räkna skiljetecken", () => {
    expect(countWords("Hej, då! Nu åker vi.")).toBe(5);
  });

  it("räknar tom text som noll", () => {
    expect(countWords("  ")).toBe(0);
  });
});

describe("estimateSeconds", () => {
  it("skalar med hastigheten", () => {
    expect(estimateSeconds(300, 1)).toBe(120);
    expect(estimateSeconds(300, 2)).toBe(60);
  });

  it("ger noll för tomt eller ogiltigt", () => {
    expect(estimateSeconds(0, 1)).toBe(0);
    expect(estimateSeconds(100, 0)).toBe(0);
  });
});

describe("formatDuration", () => {
  it("formaterar minuter och sekunder", () => {
    expect(formatDuration(65)).toBe("1:05");
  });

  it("lägger till timmar för långa dokument", () => {
    expect(formatDuration(3725)).toBe("1:02:05");
  });

  it("visar negativ tid som noll", () => {
    expect(formatDuration(-5)).toBe("0:00");
  });
});
