import assert from "node:assert/strict";
import test from "node:test";
import { isChunkLoadError, reloadForNewVersion } from "./chunkErrors.ts";

test("recognises missing-code errors from each browser and Vite", () => {
  assert.equal(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://app/assets/CanvasRoute-abc.js")), true);
  assert.equal(isChunkLoadError(new TypeError("error loading dynamically imported module")), true);
  assert.equal(isChunkLoadError(new TypeError("Importing a module script failed.")), true);
  assert.equal(isChunkLoadError(new Error("Loading chunk 42 failed.")), true);
  assert.equal(isChunkLoadError(new TypeError("Cannot read properties of undefined")), false);
  assert.equal(isChunkLoadError(null), false);
});

test("reloads once, then refuses inside the guard window", (t) => {
  const store = new Map();
  globalThis.sessionStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  let reloads = 0;
  globalThis.window = { location: { reload: () => (reloads += 1) } };
  t.after(() => {
    delete globalThis.sessionStorage;
    delete globalThis.window;
  });

  assert.equal(reloadForNewVersion(1_000_000), true);
  assert.equal(reloadForNewVersion(1_010_000), false);
  assert.equal(reloadForNewVersion(1_040_000), true);
  assert.equal(reloads, 2);
});
