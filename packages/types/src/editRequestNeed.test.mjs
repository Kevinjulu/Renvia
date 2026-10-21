import assert from "node:assert/strict";
import test from "node:test";
import { editRequestNeed, editRequestProblem, featuresForRender, PLAN_ECONOMY, STUDIO_FEATURES } from "./index.ts";

const edit = (extra = {}) => ({ mode: "prompt", method: "prompt", ...extra });

test("a prompt edit with nothing written asks for a prompt", () => {
  const missing = editRequestNeed({ edit: edit(), prompt: "  ", referenceCount: 0 });
  assert.equal(missing?.need, "prompt");
  assert.match(missing.message, /prompt/i);
  assert.doesNotMatch(missing.message, /describe/i);
});

test("an environment change alone is enough for a prompt edit", () => {
  assert.equal(editRequestNeed({ edit: edit({ environment: { timeOfDay: "dusk" } }), prompt: "", referenceCount: 0 }), null);
});

test("a reference edit asks for a reference, and Both asks for the reference first, then the prompt", () => {
  assert.equal(editRequestNeed({ edit: edit({ method: "reference" }), prompt: "", referenceCount: 0 })?.need, "reference");
  assert.equal(editRequestNeed({ edit: edit({ method: "reference-prompt" }), prompt: "match the roof", referenceCount: 0 })?.need, "reference");
  assert.equal(editRequestNeed({ edit: edit({ method: "reference-prompt" }), prompt: "", referenceCount: 1 })?.need, "prompt");
  assert.equal(editRequestNeed({ edit: edit({ method: "reference-prompt" }), prompt: "match the roof", referenceCount: 1 }), null);
});

test("a reference marked Other needs its note", () => {
  const missing = editRequestNeed({ edit: edit({ method: "reference", references: [{ target: "other" }] }), prompt: "", referenceCount: 1 });
  assert.equal(missing?.need, "reference-note");
});

test("a selection with no prompt and no reference needs a prompt", () => {
  assert.equal(editRequestNeed({ edit: edit({ maskImageUrl: "selection" }), prompt: "", referenceCount: 0 })?.need, "prompt");
});

test("editRequestProblem says the same thing as editRequestNeed", () => {
  const request = { edit: edit(), prompt: "", referenceCount: 0 };
  assert.equal(editRequestProblem(request), editRequestNeed(request).message);
  assert.equal(editRequestProblem({ edit: edit(), prompt: "Replace the door", referenceCount: 0 }), null);
});

test("only a Generate covering several elevations uses the multi-elevation feature", () => {
  assert.deepEqual(featuresForRender({ sourceType: "photo" }), ["render.standard"]);
  assert.deepEqual(featuresForRender({ sourceType: "photo", multiElevation: true }), ["render.standard", "render.multiElevation"]);
  assert.ok(STUDIO_FEATURES.some((feature) => feature.key === "render.multiElevation" && feature.group === "Render"));
});

test("every plan can render a project's four default elevations at once", () => {
  for (const plan of Object.values(PLAN_ECONOMY)) assert.ok(plan.concurrentRenderLimit >= 4);
});
