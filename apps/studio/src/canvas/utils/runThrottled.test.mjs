import assert from "node:assert/strict";
import test from "node:test";
import { runThrottled } from "./runThrottled.ts";

const busy = new Error("busy");
const fatal = new Error("no credits");
const base = (extra = {}) => ({
  freeSlots: () => null,
  waitForChange: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5))),
  isBusy: (error) => error === busy,
  isFatal: (error) => error === fatal,
  busyCooldownMs: 1,
  ...extra,
});

test("with no cap everything is sent at once and results keep their order", async () => {
  let live = 0;
  let peak = 0;
  const tasks = [1, 2, 3, 4].map((n) => async () => {
    live += 1;
    peak = Math.max(peak, live);
    await new Promise((resolve) => setTimeout(resolve, 5));
    live -= 1;
    return n;
  });
  const results = await runThrottled(tasks, base());
  assert.deepEqual(results.map((r) => r.value), [1, 2, 3, 4]);
  assert.equal(peak, 4);
});

test("a cap of 1 sends one request until a slot frees", async () => {
  let inFlight = 0; // jobs the server is still running
  const sentAt = [];
  const tasks = [0, 1, 2].map((n) => async () => {
    assert.ok(inFlight < 1, "never sent past the cap");
    inFlight += 1;
    sentAt.push(n);
    setTimeout(() => (inFlight -= 1), 15); // the job finishes later
    return n;
  });
  const results = await runThrottled(tasks, base({ freeSlots: () => 1 - inFlight }));
  assert.deepEqual(sentAt, [0, 1, 2]);
  assert.ok(results.every((r) => r.status === "fulfilled"));
});

test("a busy refusal puts the request back in line instead of failing it", async () => {
  let attempts = 0;
  const results = await runThrottled(
    [async () => { attempts += 1; if (attempts < 3) throw busy; return "ok"; }],
    base(),
  );
  assert.equal(attempts, 3);
  assert.deepEqual(results, [{ status: "fulfilled", value: "ok" }]);
});

test("a fatal refusal drops what is still waiting but keeps what was accepted", async () => {
  let inFlight = 0;
  const tasks = [
    async () => { inFlight += 1; return "a"; },
    async () => { throw fatal; },
    async () => "never",
  ];
  const results = await runThrottled(tasks, base({ freeSlots: () => 1 }));
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.equal(results[2].status, "rejected");
  assert.equal(results[2].reason, fatal);
});

test("another failure only fails its own request", async () => {
  const boom = new Error("boom");
  const results = await runThrottled([async () => { throw boom; }, async () => "fine"], base());
  assert.equal(results[0].reason, boom);
  assert.equal(results[1].value, "fine");
});

test("aborting stops anything not yet sent", async () => {
  const controller = new AbortController();
  let inFlight = 0;
  const tasks = [
    async () => { inFlight += 1; controller.abort(); return "first"; },
    async () => "second",
  ];
  const results = await runThrottled(tasks, base({ freeSlots: () => 1 - inFlight, signal: controller.signal }));
  assert.equal(results[0].value, "first");
  assert.equal(results[1].status, "rejected");
  assert.equal(results[1].reason.name, "AbortError");
});

test("reports progress as requests are accepted", async () => {
  const seen = [];
  await runThrottled([async () => 1, async () => 2], base({ onProgress: (p) => seen.push(p.accepted) }));
  assert.equal(seen.at(-1), 2);
});
