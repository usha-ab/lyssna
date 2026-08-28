import { describe, it, expect } from "vitest";
import { assemblePageText, joinHyphenation, type PdfTextItem } from "../pdf";

/** Ett textfragment på en sida. PDF räknar y nedifrån och upp. */
function item(text: string, y: number, x = 0, height = 12): PdfTextItem {
  return { text, x, y, height };
}

describe("assemblePageText", () => {
  it("läser raderna uppifrån och ned, inte i den ordning de kommer", () => {
    const text = assemblePageText([item("Andra raden.", 486), item("Första raden.", 500)]);
    expect(text).toBe("Första raden.\nAndra raden.");
  });

  it("skiljer långt isär liggande rader åt som stycken", () => {
    const text = assemblePageText([item("Sidfot.", 100), item("Brödtext.", 700)]);
    expect(text).toBe("Brödtext.\n\nSidfot.");
  });

  it("sorterar fragment inom raden från vänster till höger", () => {
    const text = assemblePageText([item("världen", 500, 80), item("Hej ", 500, 10)]);
    expect(text).toBe("Hej världen");
  });

  it("håller ihop en rad trots små skillnader i y-läge", () => {
    // Upphöjda tecken och gemener med underhäng ligger någon punkt fel.
    const text = assemblePageText([item("Not", 500), item("1", 503, 30, 8)]);
    expect(text).toBe("Not1");
  });

  it("gör ett stort radavstånd till styckesbrytning", () => {
    const text = assemblePageText([
      item("Sista raden i stycket.", 500),
      item("Nytt stycke här.", 440),
    ]);
    expect(text).toBe("Sista raden i stycket.\n\nNytt stycke här.");
  });

  it("håller ihop rader inom samma stycke", () => {
    const text = assemblePageText([
      item("En mening som fortsätter", 500),
      item("på nästa rad.", 486),
    ]);
    expect(text).toBe("En mening som fortsätter\npå nästa rad.");
  });

  it("hoppar över tomma fragment", () => {
    expect(assemblePageText([item("   ", 500), item("Text.", 480)])).toBe("Text.");
  });

  it("ger tom sträng för en sida utan fragment", () => {
    expect(assemblePageText([])).toBe("");
  });

  it("komprimerar blanktecken inom raden", () => {
    expect(assemblePageText([item("För   mycket    luft", 500)])).toBe("För mycket luft");
  });
});

describe("joinHyphenation", () => {
  it("slår ihop avstavade ord över radbrytning", () => {
    expect(joinHyphenation("fort-\nsättning")).toBe("fortsättning");
  });

  it("rör inte bindestreck mitt i en rad", () => {
    expect(joinHyphenation("e-post och e-handel")).toBe("e-post och e-handel");
  });

  it("rör inte bindestreck följt av versal — det är ofta ett egennamn", () => {
    expect(joinHyphenation("syd-\nSverige")).toBe("syd-\nSverige");
  });
});
