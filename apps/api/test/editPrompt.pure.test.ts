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

  it("tags the close-up with what was selected and where", () => {
    const prompt = buildEditPrompt({
      prompt: "make it dark oak",
      edit: { mode: "prompt", method: "prompt" },
      hasReferences: false,
      hasSelection: true,
      isCloseUp: true,
      selectionAreas: [{ label: "Front door.", placement: "in the centre" }],
    });
    expect(prompt).toBe(
      "This is a close-up of the selected part of the building: the front door, in the centre of this image. " +
        "Make it dark oak. Apply this change to the front door only. Keep everything else in the image exactly as it is.",
    );
  });

  it("locates an untagged selection on the whole image", () => {
    const prompt = buildEditPrompt({
      prompt: "paint it white",
      edit: { mode: "prompt", method: "prompt" },
      hasReferences: false,
      hasSelection: true,
      selectionAreas: [{ placement: "in the lower right" }],
    });
    expect(prompt.startsWith("The area to change is in the lower right of the image. Paint it white.")).toBe(true);
  });

  it("names the tagged element when matching it to a reference", () => {
    const prompt = buildEditPrompt({
      prompt: "",
      edit: { mode: "element", method: "reference" },
      hasReferences: true,
      hasSelection: true,
      isCloseUp: true,
      selectionAreas: [{ label: "garage door" }],
    });
    expect(prompt).toContain("Image 1 is a close-up of the selected part of the building to edit: the garage door. Image 2 is the reference.");
    expect(prompt).toContain("Make the garage door match the corresponding element in image 2");
  });

  it("ignores a tag when nothing is selected", () => {
    const prompt = buildEditPrompt({ prompt: "make the front door red", edit: { mode: "prompt", method: "prompt" }, hasReferences: false, selectionAreas: [{ label: "roof" }] });
    expect(prompt).toBe("Make the front door red. Keep everything else in the image exactly as it is.");
  });

  it("names each of several tagged areas and where they are", () => {
    const prompt = buildEditPrompt({
      prompt: "make it black",
      edit: { mode: "prompt", method: "prompt" },
      hasReferences: false,
      hasSelection: true,
      isCloseUp: true,
      selectionAreas: [
        { label: "front door", placement: "on the right" },
        { label: "window", placement: "in the upper left" },
      ],
    });
    expect(prompt).toBe(
      "This is a close-up of the selected parts of the building. " +
        "In this image, the areas to change are the front door on the right and the window in the upper left. " +
        "Make it black. Apply this change to the front door and the window only. Keep everything else in the image exactly as it is.",
    );
  });

  it("counts untagged areas without inventing names for them", () => {
    const prompt = buildEditPrompt({
      prompt: "make it black",
      edit: { mode: "prompt", method: "prompt" },
      hasReferences: false,
      hasSelection: true,
      selectionAreas: [{ label: "door", placement: "on the left" }, {}, {}],
    });
    expect(prompt).toContain("In the image, the areas to change are the door on the left and 2 more selected areas.");
    expect(prompt).toContain("Apply this change to the selected areas only.");
  });

  it("matches several tagged elements to a reference", () => {
    const prompt = buildEditPrompt({
      prompt: "",
      edit: { mode: "element", method: "reference" },
      hasReferences: true,
      hasSelection: true,
      selectionAreas: [{ label: "windows" }, { label: "windows" }],
    });
    expect(prompt).toContain("Image 2 is the reference. In image 1, the areas to change are the windows.");
    expect(prompt).toContain("Make the windows match the corresponding element in image 2");
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

describe("buildEditPrompt with several tagged references", () => {
  const references = [{ target: "roof" as const }, { target: "walls" as const }, { target: "paving" as const }];

  it("names each reference's part, in image order", () => {
    const prompt = buildEditPrompt({ prompt: "", edit: { mode: "building", method: "reference" }, hasReferences: true, references });
    expect(prompt).toContain("Image 1 is the building image to edit. Images 2 to 4 are references, each for the part it is tagged with below.");
    expect(prompt).toContain("Image 2 is a roof reference: give the roof of image 1");
    expect(prompt).toContain("Image 3 is a wall reference: give the exterior walls of image 1");
    expect(prompt).toContain("Image 4 is a paving reference: give the driveway, paths and paved ground of image 1");
    expect(prompt).toContain("Use each reference only for its own part");
    expect(prompt).toContain("Never copy a reference's building");
    expect(prompt).toContain("Keep the building's geometry");
  });

  it("puts the person's instruction first and limits what is taken", () => {
    const prompt = buildEditPrompt({
      prompt: "brick on the ground floor only",
      edit: { mode: "building", method: "reference-prompt" },
      hasReferences: true,
      references: references.slice(1),
    });
    expect(prompt).toContain("Images 2 and 3 are references");
    expect(prompt).toContain("Make this change: Brick on the ground floor only. Take from the references only what this change asks for.");
  });

  it("carries a note, and an 'other' reference's own words", () => {
    const prompt = buildEditPrompt({
      prompt: "",
      edit: { mode: "building", method: "reference" },
      hasReferences: true,
      references: [{ target: "roof", note: "only the grey “tiles”." }, { target: "other", note: "the front gate" }],
    });
    expect(prompt).toContain("Note about image 2: Only the grey tiles.");
    expect(prompt).toContain("Image 3 is a reference for the front gate: apply its design");
  });

  it("keeps a tagged reference inside a selection", () => {
    const prompt = buildEditPrompt({
      prompt: "",
      edit: { mode: "element", method: "reference" },
      hasReferences: true,
      hasSelection: true,
      isCloseUp: true,
      selectionAreas: [{ label: "roof", placement: "at the top" }],
      references: [{ target: "roof" }],
    });
    expect(prompt).toContain("Image 2 is a reference for the part named below.");
    expect(prompt).toContain("Change those parts only inside the selected area.");
  });

  it("keeps the original wording for one untagged reference", () => {
    const untagged = buildEditPrompt({ prompt: "", edit: { mode: "building", method: "reference" }, hasReferences: true });
    const look = buildEditPrompt({ prompt: "", edit: { mode: "building", method: "reference" }, hasReferences: true, references: [{ target: "look" }] });
    expect(look).toBe(untagged);
    expect(look).toContain("Image 2 is the reference.");
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
