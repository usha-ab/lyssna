import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  addDocument,
  clearTombstones,
  deleteDocument,
  loadDocuments,
  loadTombstones,
  progressRatio,
  renameDocument,
  saveProgress,
  storeText,
  titleFromText,
  MAX_DOCUMENTS,
  STORAGE_KEY,
  TOMBSTONE_KEY,
  TOMBSTONE_TTL_MS,
  type DocumentStore,
} from "../library";

/** localStorage-attrapp med valfritt tak, för att provocera kvotfel. */
function makeStore(limitChars = Infinity): DocumentStore & { raw(): string | null } {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, next) => {
      if (key === STORAGE_KEY && next.length > limitChars) throw new Error("QuotaExceededError");
      values.set(key, next);
    },
    raw: () => values.get(STORAGE_KEY) ?? null,
  };
}

describe("addDocument", () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => {
    store = makeStore();
  });

  it("sparar dokumentet och returnerar det", () => {
    const { documents, document } = addDocument(store, { text: "Hej.", source: "paste" });
    expect(documents).toHaveLength(1);
    expect(document).toMatchObject({ text: "Hej.", length: 4, dirty: true });
    expect(loadDocuments(store)[0].id).toBe(document.id);
  });

  it("härleder titel ur första raden när ingen anges", () => {
    const { document } = addDocument(store, { text: "  \nMin rubrik\nBrödtext", source: "paste" });
    expect(document.title).toBe("Min rubrik");
  });

  it("använder angiven titel", () => {
    const { document } = addDocument(store, { title: " Artikel ", text: "x", source: "url", url: "https://ex.se" });
    expect(document.title).toBe("Artikel");
    expect(document.url).toBe("https://ex.se");
  });

  it("lägger nyaste först", () => {
    addDocument(store, { text: "Först.", source: "paste" });
    const { documents } = addDocument(store, { text: "Sedan.", source: "paste" });
    expect(documents[0].text).toBe("Sedan.");
  });

  it("håller biblioteket inom antalstaket", () => {
    for (let i = 0; i < MAX_DOCUMENTS + 5; i++) {
      addDocument(store, { text: `Dokument ${i}.`, source: "paste" });
    }
    expect(loadDocuments(store)).toHaveLength(MAX_DOCUMENTS);
  });

  it("släpper äldsta textens innehåll när lagringskvoten tar slut", () => {
    const tight = makeStore(700);
    // Klockan styrs så att dokumenten får skilda tidpunkter — annars avgörs
    // vem som är äldst av millisekundens upplösning.
    vi.useFakeTimers();
    addDocument(tight, { text: "A".repeat(200), source: "paste" });
    vi.advanceTimersByTime(1000);
    addDocument(tight, { text: "B".repeat(200), source: "paste" });
    vi.useRealTimers();
    const docs = loadDocuments(tight);
    // Det nyaste måste ha kvar sin text även när det gamla inte fick plats.
    expect(docs[0].text.startsWith("B")).toBe(true);
    // Den äldre posten finns kvar med sin längd — texten hämtas från servern.
    expect(docs[1]).toMatchObject({ text: "", length: 200 });
  });
});

describe("loadDocuments", () => {
  it("ger tomt bibliotek för trasig JSON", () => {
    const store = makeStore();
    store.setItem(STORAGE_KEY, "{ inte json");
    expect(loadDocuments(store)).toEqual([]);
  });

  it("filtrerar bort poster som inte är dokument", () => {
    const store = makeStore();
    store.setItem(STORAGE_KEY, JSON.stringify([{ id: "x" }, null, 42]));
    expect(loadDocuments(store)).toEqual([]);
  });

  it("ger tomt bibliotek när lagringen inte går att läsa", () => {
    const blocked: DocumentStore = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
    };
    expect(loadDocuments(blocked)).toEqual([]);
  });
});

describe("saveProgress", () => {
  it("sparar positionen", () => {
    const store = makeStore();
    const { document } = addDocument(store, { text: "Hej på dig.", source: "paste" });
    saveProgress(store, document.id, 4);
    expect(loadDocuments(store)[0].progress).toBe(4);
  });

  it("klampar positionen till dokumentets längd", () => {
    const store = makeStore();
    const { document } = addDocument(store, { text: "Kort.", source: "paste" });
    saveProgress(store, document.id, 999);
    expect(loadDocuments(store)[0].progress).toBe(5);
  });

  it("flyttar det man lyssnar på överst — och gör det till den senaste ändringen", () => {
    const store = makeStore();
    vi.useFakeTimers();
    const { document: first } = addDocument(store, { text: "Ett.", source: "paste" });
    addDocument(store, { text: "Två.", source: "paste" });
    vi.advanceTimersByTime(1000);
    const after = saveProgress(store, first.id, 3);
    vi.useRealTimers();
    // Senast lyssnat först, och markerat för uppladdning så att positionen
    // vinner över en äldre position från en annan enhet.
    expect(after[0]).toMatchObject({ text: "Ett.", progress: 3, dirty: true });
  });

  it("gör ingenting för okänt id", () => {
    const store = makeStore();
    addDocument(store, { text: "Ett.", source: "paste" });
    expect(saveProgress(store, "finns-inte", 2)[0].progress).toBe(0);
  });
});

describe("deleteDocument och renameDocument", () => {
  it("tar bort rätt dokument och lämnar en gravsten", () => {
    const store = makeStore();
    const { document } = addDocument(store, { text: "Ett.", source: "paste" });
    addDocument(store, { text: "Två.", source: "paste" });
    const { documents, tombstones } = deleteDocument(store, document.id);
    expect(documents.map((d) => d.text)).toEqual(["Två."]);
    expect(tombstones.map((t) => t.id)).toEqual([document.id]);
  });

  it("byter namn", () => {
    const store = makeStore();
    const { document } = addDocument(store, { text: "Ett.", source: "paste" });
    expect(renameDocument(store, document.id, " Nytt namn ")[0].title).toBe("Nytt namn");
  });

  it("ignorerar tomt namn", () => {
    const store = makeStore();
    const { document } = addDocument(store, { title: "Original", text: "Ett.", source: "paste" });
    expect(renameDocument(store, document.id, "   ")[0].title).toBe("Original");
  });
});

describe("titleFromText", () => {
  it("faller tillbaka när texten saknar innehåll", () => {
    expect(titleFromText("  \n ", "Namnlöst")).toBe("Namnlöst");
  });

  it("kortar långa rubriker", () => {
    const title = titleFromText("x".repeat(200), "Namnlöst");
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("progressRatio", () => {
  it("räknar andel läst", () => {
    const store = makeStore();
    const { document } = addDocument(store, { text: "0123456789", source: "paste" });
    expect(progressRatio({ ...document, progress: 5 })).toBe(0.5);
  });

  it("räknar andel läst även när texten ligger kvar på servern", () => {
    const store = makeStore();
    const { document } = addDocument(store, { text: "0123456789", source: "paste" });
    expect(progressRatio({ ...document, text: "", progress: 2 })).toBe(0.2);
  });

  it("räknar tomt dokument som oläst", () => {
    const store = makeStore();
    const { document } = addDocument(store, { text: "", source: "paste" });
    expect(progressRatio(document)).toBe(0);
  });
});

describe("gravstenar", () => {
  it("glömmer gravstenar som passerat sin livslängd", () => {
    const store = makeStore();
    store.setItem(
      TOMBSTONE_KEY,
      JSON.stringify([
        { id: "gammal", deletedAt: Date.now() - TOMBSTONE_TTL_MS - 1000 },
        { id: "färsk", deletedAt: Date.now() },
      ])
    );
    expect(loadTombstones(store).map((t) => t.id)).toEqual(["färsk"]);
  });

  it("städas bort när servern kvitterat raderingen", () => {
    const store = makeStore();
    const { document } = addDocument(store, { text: "Ett.", source: "paste" });
    deleteDocument(store, document.id);
    expect(clearTombstones(store, [document.id])).toEqual([]);
  });

  it("ger tom lista för trasig lagring", () => {
    const store = makeStore();
    store.setItem(TOMBSTONE_KEY, "inte json");
    expect(loadTombstones(store)).toEqual([]);
  });
});

describe("storeText", () => {
  it("lägger in en hämtad text och sätter längden", () => {
    const store = makeStore();
    const { document } = addDocument(store, { text: "Kort.", source: "paste" });
    const docs = storeText(store, document.id, "En längre hämtad text.");
    expect(docs[0]).toMatchObject({ text: "En längre hämtad text.", length: 22 });
  });
});
