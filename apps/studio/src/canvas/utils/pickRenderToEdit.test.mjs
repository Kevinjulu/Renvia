import assert from "node:assert/strict";
import test from "node:test";
import { pickRenderToEdit } from "./pickRenderToEdit.ts";

// Newest first, as the jobs store keeps them.
const job = (id, over = {}) => ({ id, status: "succeeded", resultImageUrl: `https://img/${id}.jpg`, viewKey: "front", settings: null, ...over });
const pick = (jobs, activeJobId = null, view = "front") => pickRenderToEdit(jobs, activeJobId, view)?.id ?? null;

test("nothing rendered yet: nothing to edit", () => {
  assert.equal(pick([]), null);
});

test("a render that is still queued, processing or failed is not a render yet", () => {
  const jobs = [job("a", { status: "pending", resultImageUrl: null }), job("b", { status: "processing", resultImageUrl: null }), job("c", { status: "failed", resultImageUrl: null })];
  assert.equal(pick(jobs, "a"), null);
  assert.equal(pick(jobs, "b"), null);
});

test("a succeeded job without an image does not count", () => {
  assert.equal(pick([job("a", { resultImageUrl: null })]), null);
});

test("the render selected in the results panel is opened when it has finished", () => {
  const jobs = [job("new"), job("old")];
  assert.equal(pick(jobs, "old"), "old");
});

test("a selected render that is still in progress falls back to the latest finished one for the view", () => {
  const jobs = [job("busy", { status: "processing", resultImageUrl: null }), job("done-new"), job("done-old")];
  assert.equal(pick(jobs, "busy"), "done-new");
});

test("with nothing selected, the newest finished render for the active view is opened", () => {
  const jobs = [job("side", { viewKey: "side" }), job("front-new"), job("front-old")];
  assert.equal(pick(jobs, null, "front"), "front-new");
  assert.equal(pick(jobs, "gone", "front"), "front-new");
});

test("renders of other views are not picked by the fallback", () => {
  assert.equal(pick([job("side", { viewKey: "side" })], null, "front"), null);
});

test("the render selected in the panel is opened even if it belongs to another view", () => {
  assert.equal(pick([job("side", { viewKey: "side" }), job("front")], "side", "front"), "side");
});

test("the fallback skips high-resolution exports, but an export you selected is honoured", () => {
  const jobs = [job("export", { settings: { upscale: { target: "4k", parentRenderId: "front" } } }), job("front")];
  assert.equal(pick(jobs, null), "front");
  assert.equal(pick(jobs, "export"), "export");
});
