import assert from "node:assert/strict";
import test from "node:test";
import { ConnectionError, connectionErrorFrom, isConnectionError, markApiReachable, markApiUnreachable, useConnectionStore } from "./connection.ts";

test("classifies an unanswered request", () => {
  assert.equal(connectionErrorFrom(new TypeError("Failed to fetch"), false).reason, "network");
  assert.equal(connectionErrorFrom(new DOMException("aborted", "AbortError"), true).reason, "timeout");
});

test("offline wins over the other reasons", (t) => {
  // Node's navigator has no onLine flag, so give it one for this test only.
  Object.defineProperty(globalThis.navigator, "onLine", { value: false, configurable: true });
  t.after(() => delete globalThis.navigator.onLine);
  assert.equal(connectionErrorFrom(new TypeError("Failed to fetch"), true).reason, "offline");
});

test("only connection failures count as connection errors", () => {
  assert.equal(isConnectionError(new ConnectionError("timeout")), true);
  assert.equal(isConnectionError(new TypeError("Failed to fetch")), false);
  assert.equal(isConnectionError(new Error("bug")), false);
});

test("reachability flips on an unanswered request and back on the next answer", () => {
  assert.equal(useConnectionStore.getState().apiReachable, true);
  markApiUnreachable();
  assert.equal(useConnectionStore.getState().apiReachable, false);
  markApiReachable();
  assert.equal(useConnectionStore.getState().apiReachable, true);
});
