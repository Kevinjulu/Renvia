import { describe, expect, it } from "vitest";
import { parsePolishReply, rulesPolish } from "../src/lib/promptPolish.js";

describe("reading the model's reply", () => {
  it("takes the prompt and notes from JSON, even when fenced or with stray text", () => {
    expect(parsePolishReply('{"prompt": "Vertical oak cladding in warm golden-hour light.", "notes": ["Named the cladding"]}')).toEqual({
      prompt: "Vertical oak cladding in warm golden-hour light.",
      notes: ["Named the cladding"],
    });
    expect(parsePolishReply('Here you go:\n```json\n{"prompt": "Smooth white render.", "notes": []}\n```')).toEqual({ prompt: "Smooth white render.", notes: [] });
  });

  it("strips quotes and extra spaces, and keeps at most three notes", () => {
    const reply = parsePolishReply('{"prompt": "  \\"Dark bronze   frames\\"  ", "notes": ["a", "b", "c", "d", 4]}');
    expect(reply).toEqual({ prompt: "Dark bronze frames", notes: ["a", "b", "c"] });
  });

  it("shortens an over-long rewrite at a word boundary", () => {
    const reply = parsePolishReply(JSON.stringify({ prompt: "word ".repeat(200), notes: [] }));
    expect(reply!.prompt.length).toBeLessThanOrEqual(601);
    expect(reply!.prompt.endsWith("word.")).toBe(true);
  });

  it("returns nothing usable for missing or broken replies", () => {
    expect(parsePolishReply("I can't help with that.")).toBeNull();
    expect(parsePolishReply('{"prompt": ""}')).toBeNull();
    expect(parsePolishReply('{"prompt": 12}')).toBeNull();
    expect(parsePolishReply('{"prompt": "unterminated')).toBeNull();
  });
});

describe("the free tidy-up", () => {
  it("removes redesign requests from a source-locked render brief", () => {
    const result = rulesPolish({ prompt: "Warm  oak cladding at dusk. Add a second floor.", kind: "render", sourceLocked: true });
    expect(result).toMatchObject({ prompt: "Warm oak cladding at dusk", engine: "rules" });
    expect(result.blocked).toEqual(["Add a second floor"]);
  });

  it("only tidies spacing for edits and free renders", () => {
    expect(rulesPolish({ prompt: "Replace  the door with oak", kind: "edit", sourceLocked: false })).toEqual({
      prompt: "Replace the door with oak", notes: ["Tidied spacing."], blocked: [], engine: "rules",
    });
    expect(rulesPolish({ prompt: "Stone facade", kind: "render", sourceLocked: false }).notes).toEqual([]);
  });
});
