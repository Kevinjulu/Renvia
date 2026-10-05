import assert from "node:assert/strict";
import test from "node:test";
import { packOutcome } from "./billingPresentation.ts";

test("describes the starter credit pack as a focused project runway", () => {
  assert.deepEqual(packOutcome(50, 1), {
    renders: 50,
    renderLabel: "50 standard renders",
    guidance: "Ideal for testing a direction or finishing a focused project.",
  });
});

test("describes the larger credit pack as an active workflow runway", () => {
  assert.deepEqual(packOutcome(150, 2), {
    renders: 75,
    renderLabel: "75 standard renders",
    guidance: "Built for an active workflow with room to explore options.",
  });
});

test("does not invent a paid render runway when renders currently cost zero credits", () => {
  assert.deepEqual(packOutcome(50, 0), {
    renders: null,
    renderLabel: "standard renders currently require no credits",
    guidance: "Ideal for testing a direction or finishing a focused project.",
  });
});
