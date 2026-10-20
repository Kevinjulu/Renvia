import { eq } from "drizzle-orm";
import { schema } from "@renvia/db";
import { PROMPT_POLISH_DAILY_LIMIT, type PromptPolishResponse } from "@renvia/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminEnv, root } from "./support/admin.js";
import { db, makeUser } from "./support/db.js";

// "Polish prompt": a suggested architectural rewrite from a language model through fal. Free to
// users (no credits), capped per day, and counted toward the fal spending cap.
vi.mock("@clerk/backend", async () => (await import("./support/clerkStub.js")).clerkStub());

const fal = vi.hoisted(() => ({ reply: "" as string | Error, calls: [] as { endpoint: string; input: Record<string, unknown> }[] }));
vi.mock("@fal-ai/client", async () => {
  const actual = await vi.importActual<typeof import("@fal-ai/client")>("@fal-ai/client");
  return {
    ...actual,
    createFalClient: () => ({
      subscribe: async (endpoint: string, { input }: { input: Record<string, unknown> }) => {
        fal.calls.push({ endpoint, input });
        if (fal.reply instanceof Error) throw fal.reply;
        return { data: { output: fal.reply, usage: { cost: 0.0004 } } };
      },
    }),
  };
});

const env = { ...adminEnv, FAL_KEY: "test-fal-key" };
const polish = (clerkId: string, body: unknown) =>
  root.request("http://localhost/api/renders/polish-prompt", { method: "POST", headers: { Authorization: `Bearer ${clerkId}`, "content-type": "application/json" }, body: JSON.stringify(body) }, env);

beforeEach(async () => {
  fal.reply = "";
  fal.calls = [];
  await db.insert(schema.billingPlans).values({ slug: "starter", name: "Starter", description: "Starter plan" });
  await db.insert(schema.appSettings).values({ id: 1, falMode: "prod", falBudgetUsd: "5", dailyRenderLimit: null, maxProjectsPerUser: null });
  await makeUser({ clerkId: "customer", email: "customer@example.test", creditBalance: 7 });
  await makeUser({ clerkId: "admin", email: "admin@ramah.test", role: "admin" });
});

const userId = async (clerkId: string) => (await db.select().from(schema.users).where(eq(schema.users.clerkId, clerkId)))[0]!;

describe("polishing a prompt", () => {
  it("suggests the model's architectural rewrite, free, and counts its cost toward the fal cap", async () => {
    fal.reply = '{"prompt": "Vertical natural oak cladding with dark bronze frames in warm golden-hour light.", "notes": ["Named the materials", "Set the light"]}';

    const res = await polish("customer", { prompt: "pls make it look nice with wood and sunset", kind: "render" });

    expect(res.status).toBe(200);
    expect((await res.json()) as PromptPolishResponse).toEqual({
      prompt: "Vertical natural oak cladding with dark bronze frames in warm golden-hour light.",
      notes: ["Named the materials", "Set the light"],
      blocked: [],
      engine: "ai",
      remainingToday: PROMPT_POLISH_DAILY_LIMIT - 1,
    });
    expect(fal.calls).toHaveLength(1);
    expect(fal.calls[0]).toMatchObject({ endpoint: "openrouter/router", input: { prompt: "pls make it look nice with wood and sunset" } });
    expect(String(fal.calls[0]!.input.system_prompt)).toMatch(/architectural/i);
    // No credits charged; the AI cost is recorded for the spending cap.
    const customer = await userId("customer");
    expect(customer.creditBalance).toBe(7);
    const [row] = await db.select().from(schema.promptPolishes);
    expect(row).toMatchObject({ userId: customer.id, kind: "render", engine: "ai", status: "succeeded" });
    expect(row!.costMicros).toBeGreaterThanOrEqual(400);
  });

  it("still leaves redesign requests out of a source-locked render, whatever the model wrote", async () => {
    fal.reply = '{"prompt": "Warm oak cladding at golden hour. Add a second floor above the garage.", "notes": []}';

    const body = (await (await polish("customer", { prompt: "oak cladding, sunset, and add a second floor", kind: "render", sourceLocked: true })).json()) as PromptPolishResponse;

    expect(body.engine).toBe("ai");
    expect(body.prompt).toBe("Warm oak cladding at golden hour");
    expect(body.blocked).toContain("Add a second floor above the garage");
  });

  it("uses the edit instructions for edits", async () => {
    fal.reply = '{"prompt": "Replace the front door with a dark oak pivot door.", "notes": []}';
    await polish("customer", { prompt: "change door to wood", kind: "edit" });
    expect(String(fal.calls[0]!.input.system_prompt)).toMatch(/one change/i);
  });

  it("falls back to the free tidy-up when the model fails, and still costs the attempt", async () => {
    fal.reply = new Error("upstream timeout");

    const body = (await (await polish("customer", { prompt: "stone   facade", kind: "edit" })).json()) as PromptPolishResponse;

    expect(body).toMatchObject({ prompt: "stone facade", engine: "rules" });
    const [row] = await db.select().from(schema.promptPolishes);
    expect(row).toMatchObject({ engine: "rules", costMicros: 1000 });
  });

  it("never calls the model while renders are in mock mode", async () => {
    await db.update(schema.appSettings).set({ falMode: "mock" });

    const body = (await (await polish("customer", { prompt: "stone facade", kind: "render" })).json()) as PromptPolishResponse;

    expect(body.engine).toBe("rules");
    expect(fal.calls).toHaveLength(0);
    expect((await db.select().from(schema.promptPolishes))[0]!.costMicros).toBe(0);
  });

  it(`stops at ${PROMPT_POLISH_DAILY_LIMIT} a day; admins have no limit`, async () => {
    const customer = await userId("customer");
    const admin = await userId("admin");
    const today = Array.from({ length: PROMPT_POLISH_DAILY_LIMIT }, () => ({ kind: "render" as const, engine: "rules" as const, status: "succeeded" as const }));
    await db.insert(schema.promptPolishes).values([...today.map((row) => ({ ...row, userId: customer.id })), ...today.map((row) => ({ ...row, userId: admin.id }))]);
    fal.reply = '{"prompt": "Stone facade.", "notes": []}';

    const refused = await polish("customer", { prompt: "stone facade", kind: "render" });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: "polish_limit" });
    expect(fal.calls).toHaveLength(0);

    const allowed = await polish("admin", { prompt: "stone facade", kind: "render" });
    expect(allowed.status).toBe(200);
    expect(((await allowed.json()) as PromptPolishResponse).remainingToday).toBeNull();
  });
});
