import assert from "node:assert/strict";
import test from "node:test";
import { describeRenderFailure, friendlyRenderError } from "./renderErrors.ts";

test("maps the engine's own failures to plain words", () => {
  assert.equal(describeRenderFailure("Cancelled").title, "Cancelled");
  assert.equal(describeRenderFailure("Render timed out").title, "Took too long");
  assert.equal(describeRenderFailure("Render was never submitted").title, "Didn't start");
  assert.equal(describeRenderFailure("This render is no longer available.").refunded, false);
});

test("explains a safety-filter refusal without the provider's wording", () => {
  const failure = describeRenderFailure("Content flagged by moderation");
  assert.match(failure.title, /safety filter/);
  assert.equal(failure.retryable, false);
});

test("names an image that is too small and how to fix it", () => {
  const failure = describeRenderFailure("Image dimensions are too small. Minimum dimensions are 256x256 pixels.");
  assert.equal(failure.title, "An image is too small");
  assert.match(failure.detail, /512 pixels/);
  assert.equal(failure.retryable, false);
});

test("tells a busy provider apart from a broken request", () => {
  assert.equal(describeRenderFailure("Service temporarily unavailable (503)").title, "The AI service is busy");
  assert.equal(describeRenderFailure("Image not found").title, "Couldn't open an image");
  assert.equal(describeRenderFailure("Render returned no image").title, "No image came back");
});

test("keeps an export's own explanation", () => {
  assert.equal(describeRenderFailure("This render is already 4K or larger").detail, "This render is already 4K or larger");
});

test("hides anything else behind a generic, reassuring line", () => {
  for (const raw of ["Input should be a valid URL", "", null, undefined]) {
    const failure = describeRenderFailure(raw);
    assert.equal(failure.title, "Something went wrong");
    assert.equal(failure.refunded, true);
    assert.match(friendlyRenderError(raw), /^Something went wrong.*refunded/);
  }
});
