import { eq } from "drizzle-orm";
import sharp from "sharp";
import { schema } from "@renvia/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshRender } from "../src/lib/engine.js";
import { callApi } from "./support/api.js";
import { db, makeProject, makeUser, testEnv } from "./support/db.js";

// A selection edit that also changes the environment runs two fal passes inside one render:
// the selection (composited back onto the source), then the environment over the whole result.
vi.mock("@clerk/backend", async () => (await import("./support/clerkStub.js")).clerkStub());

const objects = new Map<string, Uint8Array>();
vi.mock("../src/lib/storage.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/storage.js")>("../src/lib/storage.js");
  return {
    ...actual,
    getObject: vi.fn(async (_env: unknown, key: string) => {
      const bytes = objects.get(key);
      return bytes ? { body: new Blob([new Uint8Array(bytes)]).stream(), contentType: key.endsWith(".png") ? "image/png" : "image/jpeg" } : null;
    }),
    putObject: vi.fn(async (_env: unknown, key: string, body: ArrayBuffer) => {
      objects.set(key, new Uint8Array(body));
    }),
  };
});

const fal = vi.hoisted(() => ({
  submit: vi.fn(),
  status: vi.fn(),
  result: vi.fn(),
  requests: 0,
}));
vi.mock("@fal-ai/client", async () => {
  const actual = await vi.importActual<typeof import("@fal-ai/client")>("@fal-ai/client");
  return {
    ...actual,
    createFalClient: () => ({
      storage: { upload: async () => "https://fal.test/input.jpg" },
      queue: { submit: fal.submit, status: fal.status, result: fal.result, cancel: async () => undefined },
    }),
  };
});

const ORIGIN = "http://localhost";
const KONTEXT = "fal-ai/flux-pro/kontext";
const KONTEXT_MICROS = 40_000;
const env = testEnv();

async function image(width: number, height: number, colour: string) {
  return new Uint8Array(await sharp({ create: { width, height, channels: 3, background: colour } }).jpeg().toBuffer());
}

/** White-on-black: the left half is selected. */
async function leftHalfMask(width: number, height: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="black"/><rect width="${width / 2}" height="${height}" fill="white"/></svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

async function setup(creditBalance = 10) {
  await db.insert(schema.billingPlans).values({ slug: "starter", name: "Starter", description: "Starter plan" });
  await db.insert(schema.appSettings).values({ id: 1, falMode: "prod", falBudgetUsd: "100" });
  const user = await makeUser({ clerkId: "customer", email: "customer@example.test", creditBalance });
  const project = await makeProject(user.id);
  objects.set("u/source.jpg", await image(64, 48, "#808080"));
  objects.set("u/mask.png", await leftHalfMask(64, 48));
  return { user, project };
}

async function createEdit(projectId: string, environment: Record<string, string> | null = { season: "winter" }) {
  const response = await callApi("customer", "POST", "/renders", {
    projectId,
    sourceImageUrl: `${ORIGIN}/api/uploads/u/source.jpg`,
    prompt: "make the door red",
    aspectRatio: "auto",
    style: "Photorealistic",
    generationSettings: {
      edit: { mode: "prompt", method: "prompt", maskImageUrl: `${ORIGIN}/api/uploads/u/mask.png`, ...(environment ? { environment } : {}) },
    },
  });
  expect(response.status).toBe(201);
  const { job } = (await response.json()) as { job: { id: string } };
  return job.id;
}

const row = async (id: string) => (await db.select().from(schema.renders).where(eq(schema.renders.id, id)))[0]!;
const balance = async (id: string) => (await db.select().from(schema.users).where(eq(schema.users.id, id)))[0]!.creditBalance;
const promptOf = (call: number) => (fal.submit.mock.calls[call]![1] as { input: { prompt: string } }).input.prompt;

beforeEach(() => {
  fal.requests = 0;
  fal.submit.mockReset().mockImplementation(async () => ({ request_id: `req-${++fal.requests}` }));
  fal.status.mockReset().mockResolvedValue({ status: "COMPLETED" });
  fal.result.mockReset().mockImplementation(async (_model: string, { requestId }: { requestId: string }) => ({
    data: { images: [{ url: `https://fal.test/out/${requestId}.jpg` }] },
  }));
  // fal's result images: the first pass returns red, the environment pass blue.
  vi.stubGlobal("fetch", async (url: string) => {
    const colour = url.includes("req-1") ? "#ff0000" : "#0000ff";
    return new Response(await image(64, 48, colour), { headers: { "Content-Type": "image/jpeg" } });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("two-pass edits", () => {
  it("charges and budgets both passes, then runs the environment over the whole selection result", async () => {
    const { user, project } = await setup();
    const id = await createEdit(project.id);

    const created = await row(id);
    expect(created.creditsCharged).toBe(2);
    expect(created.costMicros).toBe(2 * KONTEXT_MICROS);
    expect(await balance(user.id)).toBe(8);
    expect(fal.submit).toHaveBeenCalledTimes(1);
    expect(promptOf(0)).toContain("door red");
    expect(promptOf(0)).not.toContain("winter");

    // First pass finishes: its composite is kept, and the environment pass takes over.
    const second = await refreshRender(env, db, created, ORIGIN);
    expect(second.status).toBe("processing");
    expect(second.falRequestId).toBe("req-2");
    expect(second.model).toBe(KONTEXT);
    expect(second.settings?.edit?.intermediateImageUrl).toBe(`${ORIGIN}/api/uploads/renders/${id}-selection.jpg`);
    expect(fal.submit).toHaveBeenCalledTimes(2);
    expect(promptOf(1)).toContain("Make it winter");
    expect(promptOf(1)).not.toContain("door red");

    // The intermediate is the selection composited onto the source: red on the left, grey on the right.
    const intermediate = await sharp(objects.get(`renders/${id}-selection.jpg`)!).raw().toBuffer();
    const pixel = (x: number) => Array.from(intermediate.subarray((24 * 64 + x) * 3, (24 * 64 + x) * 3 + 3));
    expect(pixel(4)[0]).toBeGreaterThan(200);
    expect(pixel(60)[0]).toBeLessThan(160);

    // Environment pass finishes: its whole result is the final image, not re-masked.
    const done = await refreshRender(env, db, second, ORIGIN);
    expect(done.status).toBe("succeeded");
    expect(done.resultImageUrl).toBe(`${ORIGIN}/api/uploads/renders/${id}.jpg`);
    const final = await sharp(objects.get(`renders/${id}.jpg`)!).raw().toBuffer();
    expect(final[(24 * 64 + 4) * 3 + 2]).toBeGreaterThan(200);
    expect(final[(24 * 64 + 60) * 3 + 2]).toBeGreaterThan(200);
    expect(await balance(user.id)).toBe(8);
  });

  it("submits the environment pass once when the poll and the webhook race", async () => {
    const { project } = await setup();
    const id = await createEdit(project.id);
    const created = await row(id);

    await Promise.all([refreshRender(env, db, created, ORIGIN), refreshRender(env, db, created, ORIGIN)]);
    expect(fal.submit).toHaveBeenCalledTimes(2);
    expect((await row(id)).falRequestId).toBe("req-2");
  });

  it("refunds every credit but keeps the first pass's spend when the environment pass fails", async () => {
    const { user, project } = await setup();
    const id = await createEdit(project.id);
    const second = await refreshRender(env, db, await row(id), ORIGIN);

    const { ApiError } = await import("@fal-ai/client");
    fal.result.mockRejectedValueOnce(new ApiError({ message: "safety filter", status: 422, body: { detail: "Content flagged" } }));
    const failed = await refreshRender(env, db, second, ORIGIN);

    expect(failed.status).toBe("failed");
    expect(failed.errorMessage).toBe("Content flagged");
    expect(failed.costMicros).toBe(KONTEXT_MICROS);
    expect(await balance(user.id)).toBe(10);
  });

  it("keeps a selection edit without an environment change to one pass", async () => {
    const { project } = await setup();
    const id = await createEdit(project.id, null);
    const created = await row(id);
    expect(created.creditsCharged).toBe(1);
    expect(created.costMicros).toBe(KONTEXT_MICROS);

    const done = await refreshRender(env, db, created, ORIGIN);
    expect(done.status).toBe("succeeded");
    expect(fal.submit).toHaveBeenCalledTimes(1);
  });
});
