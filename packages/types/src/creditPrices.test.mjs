import assert from "node:assert/strict";
import test from "node:test";
import { baseCreditCostForRender, creditsForRender, featuresForRender, legacyCreditPrices } from "./index.ts";

// Compatibility gate for published credit prices: with nothing published, the API charges
// legacyCreditPrices, and that must cost exactly what the old formula did for every request.

const REF = ["https://api.renvia.test/uploads/ref.png"];
const MASK = "https://api.renvia.test/uploads/mask.png";

/** Every request shape the Studio can send, across routes, resolutions and edit passes. */
const REQUESTS = [
  {},
  { sourceType: "drawing" },
  { referenceImageUrls: REF },
  { referenceImageUrls: REF, fidelity: { mode: "standard", protectedFeatures: ["roof"] } },
  { referenceImageUrls: REF, fidelity: { mode: "strict", protectedFeatures: ["roof"] } },
  { fidelity: { mode: "strict", protectedFeatures: ["roof"] } },
  { highRes: { target: "4k" } },
  { highRes: { target: "8k" } },
  { referenceImageUrls: REF, fidelity: { mode: "strict", protectedFeatures: ["roof"] }, highRes: { target: "8k" } },
  { referenceImageUrls: REF, highRes: { target: "4k" } },
  { edit: { mode: "prompt" } },
  { edit: { mode: "element", maskImageUrl: MASK } },
  { edit: { mode: "element", maskImageUrl: MASK, environment: { season: "winter" } } },
  { edit: { mode: "element", maskImageUrl: MASK }, referenceImageUrls: REF },
  { upscale: { target: "4k", parentRenderId: "r" } },
  { upscale: { target: "8k", parentRenderId: "r" } },
];

test("legacy prices charge what baseCreditCostForRender × creditsPerImage charged", () => {
  for (const creditsPerImage of [0, 1, 2, 3, 7]) {
    const prices = legacyCreditPrices(creditsPerImage, 1);
    for (const settings of REQUESTS) {
      assert.equal(
        creditsForRender(settings, prices),
        baseCreditCostForRender(settings) * creditsPerImage,
        `${JSON.stringify(settings)} at ${creditsPerImage} per image`,
      );
    }
  }
});

test("legacy selection price is creditsPerSelection", () => {
  assert.equal(legacyCreditPrices(1, 3).selection, 3);
});

test("published prices are absolute, with no per-image multiplier on top", () => {
  const prices = { render: 3, references: 4, fidelity: 6, editPass: 2, upscale4k: 5, upscale8k: 9, selection: 1 };
  assert.equal(creditsForRender({}, prices), 3);
  assert.equal(creditsForRender({ referenceImageUrls: REF }, prices), 4);
  assert.equal(creditsForRender({ referenceImageUrls: REF, fidelity: { mode: "strict", protectedFeatures: ["roof"] }, highRes: { target: "8k" } }, prices), 15);
  assert.equal(creditsForRender({ edit: { mode: "element", maskImageUrl: MASK, environment: { season: "winter" } } }, prices), 4);
  assert.equal(creditsForRender({ upscale: { target: "4k", parentRenderId: "r" } }, prices), 5);
});

test("every request maps to at least one Studio feature", () => {
  for (const settings of REQUESTS) assert.ok(featuresForRender(settings).length > 0, JSON.stringify(settings));
});
