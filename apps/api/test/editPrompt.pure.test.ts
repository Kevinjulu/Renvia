import { describe, expect, it } from "vitest";
import { buildEditPrompt, buildEnvironmentPrompt } from "../src/lib/prompts.js";

// Pure string building: no database (setup.ts skips the reset for *.pure.test.ts files).

describe("buildEditPrompt", () => {
  it("passes a prompt-only edit through with the keep-the-rest guard", () => {
    const prompt = buildEditPrompt({ prompt: "make the front door red", edit: { mode: "prompt", method: "prompt" }, hasReferences: false });
    expect(prompt).toBe("Make the front door red. Keep everything else in the image exactly as it is.");
  });

  it("builds an action verb around the prompt", () => {
    const prompt = buildEditPrompt({ prompt: "a balcony", edit: { mode: "element", method: "prompt", action: "add" }, hasReferences: false });
    expect(prompt).toContain("Add a balcony to the building.");
  });

  it("names the close-up crop of a selection", () => {
    const prompt = buildEditPrompt({
      prompt: "make it oak",
      edit: { mode: "prompt", method: "prompt" },
      hasReferences: false,
      hasSelection: true,
      isCloseUp: true,
    });
    expect(prompt.startsWith("This is a close-up of the selected part of the building.")).toBe(true);
  });

  it("applies a whole-image reference as a look, never a new building", () => {
    const prompt = buildEditPrompt({ prompt: "", edit: { mode: "building", method: "reference" }, hasReferences: true });
    expect(prompt).toContain("Image 1 is the building image to edit. Image 2 is the reference.");
    expect(prompt).toContain("Apply the look of image 2");
    expect(prompt).toContain("Never copy image 2's building");
    expect(prompt).toContain("Keep the building's geometry");
  });

  it("matches a selected element's design to the reference", () => {
    const prompt = buildEditPrompt({
      prompt: "",
      edit: { mode: "element", method: "reference" },
      hasReferences: true,
      hasSelection: true,
      isCloseUp: true,
    });
    expect(prompt).toContain("Image 1 is a close-up of the selected part");
    expect(prompt).toContain("Make the selected element match the corresponding element in image 2");
  });

  it("takes only what the prompt asks for from the reference", () => {
    const prompt = buildEditPrompt({
      prompt: "make the windows look like the reference",
      edit: { mode: "element", method: "reference-prompt" },
      hasReferences: true,
    });
    expect(prompt).toContain("Use image 2 as the reference for this change: Make the windows look like the reference.");
    expect(prompt).toContain("Take from image 2 only what this asks for");
  });

  it("derives the method for older edit jobs", () => {
    const prompt = buildEditPrompt({ prompt: "", edit: { mode: "building" }, hasReferences: true });
    expect(prompt).toContain("Apply the look of image 2");
  });

  it("includes the environment when the whole image is edited", () => {
    const prompt = buildEditPrompt({
      prompt: "",
      edit: { mode: "prompt", method: "prompt", environment: { timeOfDay: "dusk", season: "winter", facadeMaterial: "timber", facadeColor: "charcoal" } },
      hasReferences: false,
    });
    expect(prompt).toContain("Clad the facade walls in timber cladding, coloured charcoal");
    expect(prompt).toContain("Set the scene at dusk");
    expect(prompt).toContain("Make it winter");
    expect(prompt).toContain("Keep the building's geometry");
    expect(prompt).toContain("Apart from these changes");
  });

  it("leaves the environment to its own pass when an area is selected", () => {
    const prompt = buildEditPrompt({
      prompt: "make the door red",
      edit: { mode: "prompt", method: "prompt", maskImageUrl: "https://x/m.png", environment: { weather: "snow" } },
      hasReferences: false,
      hasSelection: true,
    });
    expect(prompt).not.toContain("snow");
  });

  it("keeps a non-photoreal render's style", () => {
    const prompt = buildEditPrompt({ prompt: "red door", edit: { mode: "prompt" }, hasReferences: false, style: "Watercolor sketch" });
    expect(prompt).toContain("Keep this in a loose architectural watercolour sketch");
  });
});

describe("buildEnvironmentPrompt", () => {
  it("describes only the environment, with the form lock", () => {
    const prompt = buildEnvironmentPrompt({ environment: { style: "scandinavian", weather: "overcast" } });
    expect(prompt).toContain("Restyle the finishes and details of the building as Scandinavian");
    expect(prompt).toContain("overcast sky");
    expect(prompt).toContain("Keep the building's geometry");
  });
});
