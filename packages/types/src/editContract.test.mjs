import assert from "node:assert/strict";
import test from "node:test";
import { baseCreditCostForRender, editMethodFor, editPassCount, editRequestProblem, hasEnvironmentChange } from "./index.ts";

const MASK = "https://api.renvia.test/uploads/mask.png";

test("environment: unset or blank fields are no change", () => {
  assert.equal(hasEnvironmentChange(undefined), false);
  assert.equal(hasEnvironmentChange({}), false);
  assert.equal(hasEnvironmentChange({ style: "  " }), false);
  assert.equal(hasEnvironmentChange({ season: "winter" }), true);
});

test("method: explicit wins, older jobs derive it", () => {
  assert.equal(editMethodFor({ mode: "element", method: "reference" }, { hasReferences: true, hasPrompt: true }), "reference");
  assert.equal(editMethodFor({ mode: "prompt" }, { hasReferences: false, hasPrompt: true }), "prompt");
  assert.equal(editMethodFor({ mode: "building" }, { hasReferences: true, hasPrompt: false }), "reference");
  assert.equal(editMethodFor({ mode: "element" }, { hasReferences: true, hasPrompt: true }), "reference-prompt");
});

test("passes: only a selection plus an environment change needs a second pass", () => {
  assert.equal(editPassCount({ mode: "prompt" }), 1);
  assert.equal(editPassCount({ mode: "prompt", maskImageUrl: MASK }), 1);
  assert.equal(editPassCount({ mode: "prompt", environment: { timeOfDay: "dusk" } }), 1);
  assert.equal(editPassCount({ mode: "prompt", maskImageUrl: MASK, environment: { timeOfDay: "dusk" } }), 2);
});

test("credits: edits cost one per pass, never the strict-fidelity price", () => {
  const strict = { mode: "strict", protectedFeatures: ["roof"] };
  assert.equal(baseCreditCostForRender({ edit: { mode: "prompt" }, referenceImageUrls: ["r"], fidelity: strict }), 1);
  assert.equal(baseCreditCostForRender({ edit: { mode: "prompt", maskImageUrl: MASK, environment: { weather: "snow" } } }), 2);
  assert.equal(baseCreditCostForRender({ referenceImageUrls: ["r"], fidelity: strict }), 2);
  assert.equal(baseCreditCostForRender({}), 1);
});

test("request: each method needs its own inputs", () => {
  const problem = (edit, prompt = "", referenceCount = 0) => editRequestProblem({ edit, prompt, referenceCount });

  assert.ok(problem({ mode: "prompt", method: "prompt" }));
  assert.equal(problem({ mode: "prompt", method: "prompt" }, "make the door red"), null);
  // An environment change on its own is a complete edit.
  assert.equal(problem({ mode: "prompt", method: "prompt", environment: { season: "winter" } }), null);

  assert.ok(problem({ mode: "building", method: "reference" }, "anything"));
  assert.equal(problem({ mode: "building", method: "reference" }, "", 1), null);

  assert.ok(problem({ mode: "element", method: "reference-prompt" }, "match the windows"));
  assert.ok(problem({ mode: "element", method: "reference-prompt" }, "", 1));
  assert.equal(problem({ mode: "element", method: "reference-prompt" }, "match the windows", 1), null);

  // One reference per edit.
  assert.ok(problem({ mode: "building", method: "reference" }, "", 2));

  // A selection needs something to do inside it; the environment alone is a whole-image change.
  assert.ok(problem({ mode: "prompt", method: "prompt", maskImageUrl: MASK, environment: { season: "winter" } }));
  assert.equal(problem({ mode: "prompt", method: "prompt", maskImageUrl: MASK, environment: { season: "winter" } }, "red door"), null);
  assert.equal(problem({ mode: "element", method: "reference", maskImageUrl: MASK }, "", 1), null);

  // Older clients send no method: any one input is enough.
  assert.ok(problem({ mode: "prompt" }));
  assert.equal(problem({ mode: "prompt" }, "", 1), null);
});
