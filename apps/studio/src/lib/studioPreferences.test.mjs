import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_STUDIO_PREFERENCES, STUDIO_PREFERENCES_STORAGE_KEY, readStudioPreferences, writeStudioPreferences } from "./studioPreferences.ts";

function withStorage(t, saved) {
  const store = new Map(saved === undefined ? [] : [[STUDIO_PREFERENCES_STORAGE_KEY, JSON.stringify(saved)]]);
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  t.after(() => delete globalThis.localStorage);
  return store;
}

test("new users start on Maximum style influence", (t) => {
  withStorage(t);
  assert.equal(DEFAULT_STUDIO_PREFERENCES.defaultStyleInfluence, 4);
  assert.equal(readStudioPreferences().defaultStyleInfluence, 4);
});

test("a Strong saved under the old default moves up to Maximum", (t) => {
  withStorage(t, { ...DEFAULT_STUDIO_PREFERENCES, defaultStyleInfluence: 3 });
  assert.equal(readStudioPreferences().defaultStyleInfluence, 4);
});

test("a deliberately lower choice is kept", (t) => {
  withStorage(t, { ...DEFAULT_STUDIO_PREFERENCES, defaultStyleInfluence: 2 });
  assert.equal(readStudioPreferences().defaultStyleInfluence, 2);
});

test("Strong chosen after the change is kept", (t) => {
  const store = withStorage(t);
  writeStudioPreferences({ defaultStyleInfluence: 3 });
  assert.equal(JSON.parse(store.get(STUDIO_PREFERENCES_STORAGE_KEY)).version, 2);
  assert.equal(readStudioPreferences().defaultStyleInfluence, 3);
});
