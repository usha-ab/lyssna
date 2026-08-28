import { describe, it, expect, vi } from "vitest";
import { syncLibrary, ensureText, NotSignedIn, type RemoteApi } from "../client-sync";
import { addDocument, deleteDocument, loadDocuments, loadTombstones, type DocumentStore } from "../library";
import type { RemoteSummary } from "../sync";

function makeStore(): DocumentStore {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

function fakeApi(over: Partial<RemoteApi> = {}): RemoteApi {
  return {
    list: async () => [],
    upload: async () => {},
    patchProgress: async () => {},
    remove: async () => {},
    fetchText: async () => "",
    ...over,
  };
}

describe("syncLibrary", () => {
  it("laddar upp lokala dokument och rensar deras osparade-flagga", async () => {
    const store = makeStore();
    addDocument(store, { text: "Min text.", source: "paste" });
    const upload = vi.fn(async () => {});

    const result = await syncLibrary(store, fakeApi({ upload }));

    expect(upload).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("synced");
    expect(result.documents[0].dirty).toBe(false);
    expect(loadDocuments(store)[0].dirty).toBe(false);
  });

  it("behåller osparade-flaggan när uppladdningen misslyckas", async () => {
    const store = makeStore();
    addDocument(store, { text: "Min text.", source: "paste" });

    const result = await syncLibrary(
      store,
      fakeApi({
        upload: async () => {
          throw new Error("nätet dog");
        },
      })
    );

    expect(result.documents[0].dirty).toBe(true);
  });

  it("hämtar hem dokument från andra enheter", async () => {
    const store = makeStore();
    const remote: RemoteSummary = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      title: "Från datorn",
      source: "epub",
      source_url: null,
      progress: 120,
      created_at: new Date(1000).toISOString(),
      updated_at: new Date(2000).toISOString(),
      content_length: 5000,
    };

    const result = await syncLibrary(store, fakeApi({ list: async () => [remote] }));

    expect(result.documents[0]).toMatchObject({
      title: "Från datorn",
      source: "epub",
      text: "",
      length: 5000,
      progress: 120,
    });
  });

  it("raderar på servern och städar bort gravstenen", async () => {
    const store = makeStore();
    const { document } = addDocument(store, { text: "Bort med den.", source: "paste" });
    deleteDocument(store, document.id);
    const remove = vi.fn(async () => {});

    await syncLibrary(store, fakeApi({ remove }));

    expect(remove).toHaveBeenCalledWith(document.id);
    expect(loadTombstones(store)).toEqual([]);
  });

  it("behåller gravstenen när raderingen inte gick fram", async () => {
    const store = makeStore();
    const { document } = addDocument(store, { text: "Bort med den.", source: "paste" });
    deleteDocument(store, document.id);

    await syncLibrary(
      store,
      fakeApi({
        remove: async () => {
          throw new Error("nätet dog");
        },
      })
    );

    expect(loadTombstones(store).map((t) => t.id)).toEqual([document.id]);
  });

  it("lämnar biblioteket orört när användaren är utloggad", async () => {
    const store = makeStore();
    addDocument(store, { text: "Lokal text.", source: "paste" });

    const result = await syncLibrary(
      store,
      fakeApi({
        list: async () => {
          throw new NotSignedIn();
        },
      })
    );

    expect(result.status).toBe("signed-out");
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].dirty).toBe(true);
  });

  it("rapporterar offline när nätet inte svarar", async () => {
    const store = makeStore();
    const result = await syncLibrary(
      store,
      fakeApi({
        list: async () => {
          throw new Error("fetch failed");
        },
      })
    );
    expect(result.status).toBe("offline");
  });
});

describe("ensureText", () => {
  it("hämtar texten för ett dokument som bara har metadata", async () => {
    const store = makeStore();
    const { document } = addDocument(store, { text: "x", source: "paste" });
    const stub = { ...document, text: "", length: 9 };

    const filled = await ensureText(store, fakeApi({ fetchText: async () => "Hämtad." }), stub);

    expect(filled.text).toBe("Hämtad.");
    expect(loadDocuments(store)[0].text).toBe("Hämtad.");
  });

  it("hämtar inte om texten redan finns", async () => {
    const store = makeStore();
    const { document } = addDocument(store, { text: "Finns redan.", source: "paste" });
    const fetchText = vi.fn(async () => "Skulle inte hämtas");

    const same = await ensureText(store, fakeApi({ fetchText }), document);

    expect(fetchText).not.toHaveBeenCalled();
    expect(same.text).toBe("Finns redan.");
  });
});
