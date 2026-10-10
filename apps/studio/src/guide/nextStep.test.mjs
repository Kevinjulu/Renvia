import assert from "node:assert/strict";
import test from "node:test";
import { hasRenderDirection, nextStudioStep } from "./nextStep.ts";

test("suggests uploading first, whatever else is set", () => {
  assert.equal(nextStudioStep({ hasElevation: false, hasReference: false, hasPrompt: false }), "upload");
  assert.equal(nextStudioStep({ hasElevation: false, hasReference: true, hasPrompt: true }), "upload");
});

test("suggests a reference once an elevation is uploaded", () => {
  assert.equal(nextStudioStep({ hasElevation: true, hasReference: false, hasPrompt: false }), "reference");
});

test("suggests Generate once there is a reference or a prompt", () => {
  assert.equal(nextStudioStep({ hasElevation: true, hasReference: true, hasPrompt: false }), "generate");
  assert.equal(nextStudioStep({ hasElevation: true, hasReference: false, hasPrompt: true }), "generate");
});

test("Generate needs a prompt or a reference", () => {
  assert.equal(hasRenderDirection({ hasReference: false, hasPrompt: false }), false);
  assert.equal(hasRenderDirection({ hasReference: true, hasPrompt: false }), true);
  assert.equal(hasRenderDirection({ hasReference: false, hasPrompt: true }), true);
});
