import assert from "node:assert/strict";
import test from "node:test";
import { friendlyRenderError } from "./renderErrors.ts";

test("maps the engine's own failures to plain words", () => {
  assert.match(friendlyRenderError("Cancelled"), /^You cancelled this/);
  assert.match(friendlyRenderError("Render timed out"), /took too long/);
  assert.match(friendlyRenderError("Render was never submitted"), /didn't start/);
  assert.equal(friendlyRenderError("This render is no longer available."), "This render is no longer available.");
});

test("explains a safety-filter refusal without the provider's wording", () => {
  assert.match(friendlyRenderError("Content flagged by moderation"), /safety filter/);
});

test("keeps an export's own explanation", () => {
  assert.equal(friendlyRenderError("This render is already 4K or larger"), "This render is already 4K or larger");
});

test("hides anything else behind a generic, reassuring line", () => {
  for (const raw of ["Input should be a valid URL", "Image not found", "", null, undefined]) {
    assert.match(friendlyRenderError(raw), /^Something went wrong.*refunded/);
  }
});
