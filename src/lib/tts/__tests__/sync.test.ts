import { describe, it, expect } from "vitest";
import { planSync, type RemoteSummary } from "../sync";
import type { ListenDocument } from "../library";

function localDoc(over: Partial<ListenDocument> = {}): ListenDocument {
  const text = over.text ?? "Lokal text.";
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Lokal",
    text,
    length: over.length ?? text.length,
    source: "paste",
    createdAt: 1000,
    updatedAt: 2000,
    progress: 0,
    ...over,
  };
}

function remoteDoc(over: Partial<RemoteSummary> = {}): RemoteSummary {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Fjärr",
    source: "paste",
    source_url: null,
    progress: 0,
    created_at: new Date(1000).toISOString(),
    updated_at: new Date(2000).toISOString(),
    content_length: "Lokal text.".length,
    ...over,
  };
}

describe("planSync", () => {
  it("laddar upp dokument som bara finns lokalt", () => {
    const plan = planSync([localDoc()], [], []);
    expect(plan.upload.map((d) => d.id)).toEqual([localDoc().id]);
    expect(plan.documents).toHaveLength(1);
  });

  it("hämtar hem dokument som bara finns på servern, utan text", () => {
    const plan = planSync([], [remoteDoc({ title: "Från datorn", content_length: 4200 })], []);
    expect(plan.upload).toEqual([]);
    expect(plan.documents[0]).toMatchObject({ title: "Från datorn", text: "", length: 4200 });
  });

  it("låter den senaste ändringen vinna — lokalt nyare", () => {
    const plan = planSync(
      [localDoc({ title: "Nytt namn", updatedAt: 5000 })],
      [remoteDoc({ title: "Gammalt namn", updated_at: new Date(3000).toISOString() })],
      []
    );
    expect(plan.documents[0].title).toBe("Nytt namn");
    expect(plan.upload).toHaveLength(1);
  });

  it("låter den senaste ändringen vinna — servern nyare", () => {
    const plan = planSync(
      [localDoc({ title: "Gammalt namn", updatedAt: 2000, progress: 5 })],
      [
        remoteDoc({
          title: "Nytt namn",
          progress: 300,
          updated_at: new Date(9000).toISOString(),
        }),
      ],
      []
    );
    expect(plan.documents[0]).toMatchObject({ title: "Nytt namn", progress: 300 });
    expect(plan.upload).toEqual([]);
  });

  it("behåller den lokala texten när servern bara ändrat metadata", () => {
    const plan = planSync(
      [localDoc({ updatedAt: 2000 })],
      [remoteDoc({ progress: 7, updated_at: new Date(9000).toISOString() })],
      []
    );
    expect(plan.documents[0].text).toBe("Lokal text.");
  });

  it("släpper den lokala texten när serverns text är en annan längd", () => {
    const plan = planSync(
      [localDoc({ updatedAt: 2000 })],
      [remoteDoc({ content_length: 99999, updated_at: new Date(9000).toISOString() })],
      []
    );
    // Tom text betyder "hämta om vid öppning".
    expect(plan.documents[0].text).toBe("");
    expect(plan.documents[0].length).toBe(99999);
  });

  it("raderar på servern och håller dokumentet borta lokalt", () => {
    const id = localDoc().id;
    const plan = planSync([localDoc()], [remoteDoc()], [{ id, deletedAt: 8000 }]);
    expect(plan.documents).toEqual([]);
    expect(plan.deleteRemote).toEqual([id]);
    expect(plan.upload).toEqual([]);
  });

  it("låter inte ett raderat dokument komma tillbaka från servern", () => {
    const id = remoteDoc().id;
    const plan = planSync([], [remoteDoc()], [{ id, deletedAt: 8000 }]);
    expect(plan.documents).toEqual([]);
    expect(plan.deleteRemote).toEqual([id]);
  });

  it("laddar inte upp en post vars text tappats lokalt", () => {
    const plan = planSync([localDoc({ text: "", length: 500 })], [], []);
    expect(plan.upload).toEqual([]);
    expect(plan.documents).toHaveLength(1);
  });

  it("sorterar biblioteket med senast ändrat först", () => {
    const plan = planSync(
      [localDoc({ id: "22222222-2222-4222-8222-222222222222", updatedAt: 1000 })],
      [remoteDoc({ id: "33333333-3333-4333-8333-333333333333", updated_at: new Date(9000).toISOString() })],
      []
    );
    expect(plan.documents.map((d) => d.updatedAt)).toEqual([9000, 1000]);
  });

  it("tar med gravstenar för dokument servern redan saknar, så de kan städas", () => {
    const plan = planSync([], [], [{ id: "44444444-4444-4444-8444-444444444444", deletedAt: 1 }]);
    expect(plan.deleteRemote).toEqual(["44444444-4444-4444-8444-444444444444"]);
  });
});
