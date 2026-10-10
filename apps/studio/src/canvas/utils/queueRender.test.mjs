import assert from "node:assert/strict";
import test from "node:test";
import { queueRender, RenderNotConfirmedError } from "./queueRender.ts";

/** Stands in for lib/connection.ts's ConnectionError, which queueRender matches by name. */
class ConnectionError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "ConnectionError";
  }
}

const body = (prompt = "a house") => ({ projectId: "p", sourceImageUrl: "https://x/s.jpg", prompt, aspectRatio: "auto", style: "Photorealistic" });

/** A fake createRender that answers with the scripted outcomes in order and records each request. */
function server(...outcomes) {
  const calls = [];
  const createRender = async (request) => {
    calls.push(request);
    const outcome = outcomes.shift();
    if (outcome instanceof Error) throw outcome;
    return { job: { id: outcome ?? "job-1" } };
  };
  return { calls, createRender };
}

/** Lets queueRender's waits elapse instantly. */
async function settle(t, promise) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
    t.mock.timers.tick(10_000);
  }
  return promise;
}

test("a request that went unanswered is re-sent with the same key", async (t) => {
  const { calls, createRender } = server(new ConnectionError("timeout"), "job-1");
  let slow = 0;
  const response = await settle(t, queueRender(createRender, body(), { slot: "a", onSlow: () => (slow += 1) }));
  assert.equal(response.job.id, "job-1");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].idempotencyKey, calls[1].idempotencyKey);
  assert.equal(slow, 1);
});

test("gives up after the re-checks, and a second click reuses the key", async (t) => {
  const first = server(new ConnectionError("network"), new ConnectionError("network"), new ConnectionError("network"));
  await assert.rejects(settle(t, queueRender(first.createRender, body("twice"), { slot: "b" })), RenderNotConfirmedError);
  assert.equal(first.calls.length, 3);

  const second = server("job-2");
  await queueRender(second.createRender, body("twice"), { slot: "b" });
  assert.equal(second.calls[0].idempotencyKey, first.calls[0].idempotencyKey);

  // Confirmed now, so the next click is a new request with a new key.
  const third = server("job-3");
  await queueRender(third.createRender, body("twice"), { slot: "b" });
  assert.notEqual(third.calls[0].idempotencyKey, first.calls[0].idempotencyKey);
});

test("an answer from the server is final and never retried", async () => {
  const refusal = Object.assign(new Error("insufficient credits"), { status: 402 });
  const { calls, createRender } = server(refusal);
  await assert.rejects(queueRender(createRender, body(), { slot: "c" }), refusal);
  assert.equal(calls.length, 1);
});

test("identical requests in one click get their own keys", async () => {
  const { calls, createRender } = server("job-a", "job-b");
  await Promise.all([queueRender(createRender, body("same"), { slot: "front#0" }), queueRender(createRender, body("same"), { slot: "front#1" })]);
  assert.notEqual(calls[0].idempotencyKey, calls[1].idempotencyKey);
});
