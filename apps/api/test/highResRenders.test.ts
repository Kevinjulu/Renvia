import { eq } from "drizzle-orm";
import sharp from "sharp";
import { schema } from "@renvia/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelRender, refreshRender } from "../src/lib/engine.js";
import { callApi } from "./support/api.js";
import { db, makeProject, makeUser, testEnv } from "./support/db.js";

// A render made with a 4K or 8K output resolution runs two fal passes inside one job: the
// render itself, then an upscale of its result. The standard result stays the render's image;
// the upscaled copy sits beside it for downloads.
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
      storage: { upload: async () => "https://fal.test/input.png" },
      queue: { submit: fal.submit, status: fal.status, result: fal.result, cancel: async () => undefined },
    }),
  };
});

const ORIGIN = "http://localhost";
const KONTEXT = "fal-ai/flux-pro/kontext";
const BRIA = "bria/increase-resolution";
const KONTEXT_MICROS = 40_000;
const env = testEnv();

async function image(width: number, height: number) {
  return new Uint8Array(await sharp({ create: { width, height, channels: 3, background: "#808080" } }).jpeg().toBuffer());
}

async function setup(falMode: "prod" | "mock" = "prod") {
  await db.insert(schema.billingPlans).values({ slug: "starter", name: "Starter", description: "Starter plan" });
  await db.insert(schema.appSettings).values({ id: 1, falMode, falBudgetUsd: "100" });
  const user = await makeUser({ clerkId: "customer", email: "customer@example.test", creditBalance: 10 });
  const project = await makeProject(user.id);
  objects.set("u/source.jpg", await image(64, 48));
  return { user, project };
}

async function createRender(projectId: string, generationSettings: Record<string, unknown>) {
  return callApi("customer", "POST", "/renders", {
    projectId,
    sourceImageUrl: `${ORIGIN}/api/uploads/u/source.jpg`,
    prompt: "warm evening light",
    aspectRatio: "auto",
    style: "Photorealistic",
    generationSettings: { sourceType: "photo", ...generationSettings },
  });
}

async function create4k(projectId: string) {
  const response = await createRender(projectId, { highRes: { target: "4k" } });
  expect(response.status).toBe(201);
  return ((await response.json()) as { job: { id: string } }).job.id;
}

const row = async (id: string) => (await db.select().from(schema.renders).where(eq(schema.renders.id, id)))[0]!;
const balance = async (id: string) => (await db.select().from(schema.users).where(eq(schema.users.id, id)))[0]!.creditBalance;

beforeEach(() => {
  objects.clear();
  fal.requests = 0;
  fal.submit.mockReset().mockImplementation(async () => ({ request_id: `req-${++fal.requests}` }));
  fal.status.mockReset().mockResolvedValue({ status: "COMPLETED" });
  fal.result.mockReset().mockImplementation(async (_model: string, { requestId }: { requestId: string }) => ({
    data: { images: [{ url: `https://fal.test/out/${requestId}.jpg` }], seed: 1234 },
  }));
  // The render pass returns a standard-size image; the upscaler overshoots the 4K edge.
  vi.stubGlobal("fetch", async (url: string) => {
    const bytes = url.includes("req-1") ? await image(64, 48) : await image(4000, 3000);
    return new Response(bytes, { headers: { "Content-Type": "image/jpeg" } });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("renders with an output resolution", () => {
  it("charges and budgets the upscale, then upscales the finished render inside the same job", async () => {
    const { user, project } = await setup();
    const id = await create4k(project.id);

    const created = await row(id);
    expect(created.creditsCharged).toBe(2);
    expect(created.costMicros).toBe(KONTEXT_MICROS + 40_000);
    expect(await balance(user.id)).toBe(8);

    // Render pass finishes: its result is stored as the standard image and the upscale starts.
    const second = await refreshRender(env, db, created, ORIGIN);
    expect(second.status).toBe("processing");
    expect(second.model).toBe(BRIA);
    expect(second.falRequestId).toBe("req-2");
    expect(second.seed).toBe(1234);
    expect(second.settings?.highRes?.baseImageUrl).toBe(`${ORIGIN}/api/uploads/renders/${id}.jpg`);
    expect(fal.submit.mock.calls[1]![0]).toBe(BRIA);

    // Upscale finishes: the render succeeds with both copies, the large one capped at 4K.
    const done = await refreshRender(env, db, second, ORIGIN);
    expect(done.status).toBe("succeeded");
    expect(done.resultImageUrl).toBe(`${ORIGIN}/api/uploads/renders/${id}.jpg`);
    expect(done.settings?.highRes?.imageUrl).toBe(`${ORIGIN}/api/uploads/renders/${id}-4k.jpg`);
    expect(await sharp(objects.get(`renders/${id}-4k.jpg`)!).metadata()).toMatchObject({ width: 3840, height: 2880, format: "jpeg" });
    expect(await balance(user.id)).toBe(8);
  });

  it("starts the upscale once when the poll and the webhook race", async () => {
    const { project } = await setup();
    const id = await create4k(project.id);
    const created = await row(id);

    await Promise.all([refreshRender(env, db, created, ORIGIN), refreshRender(env, db, created, ORIGIN)]);
    expect(fal.submit).toHaveBeenCalledTimes(2);
    expect((await row(id)).falRequestId).toBe("req-2");
  });

  it("keeps the standard render and refunds only the upscale when the upscale fails", async () => {
    const { user, project } = await setup();
    const id = await create4k(project.id);
    const second = await refreshRender(env, db, await row(id), ORIGIN);

    const { ApiError } = await import("@fal-ai/client");
    fal.result.mockRejectedValueOnce(new ApiError({ message: "upscaler down", status: 500, body: { detail: "Upscaler unavailable" } }));
    const done = await refreshRender(env, db, second, ORIGIN);

    expect(done.status).toBe("succeeded");
    expect(done.resultImageUrl).toBe(`${ORIGIN}/api/uploads/renders/${id}.jpg`);
    expect(done.settings?.highRes).toMatchObject({ error: "Upscaler unavailable" });
    expect(done.settings?.highRes?.imageUrl).toBeUndefined();
    expect(done.creditsCharged).toBe(1);
    expect(done.costMicros).toBe(KONTEXT_MICROS);
    expect(await balance(user.id)).toBe(9);

    // Another refresh of the finished render changes nothing.
    await refreshRender(env, db, done, ORIGIN);
    expect(await balance(user.id)).toBe(9);
  });

  it("keeps the standard render when the upscale is cancelled", async () => {
    const { user, project } = await setup();
    const id = await create4k(project.id);
    const second = await refreshRender(env, db, await row(id), ORIGIN);

    const cancelled = await cancelRender(env, db, second);

    expect(cancelled.status).toBe("succeeded");
    expect(cancelled.settings?.highRes?.error).toBe("Cancelled");
    expect(await balance(user.id)).toBe(9);
  });

  it("refunds everything when the render pass itself fails", async () => {
    const { user, project } = await setup();
    const id = await create4k(project.id);

    const { ApiError } = await import("@fal-ai/client");
    fal.result.mockRejectedValueOnce(new ApiError({ message: "safety filter", status: 422, body: { detail: "Content flagged" } }));
    const failed = await refreshRender(env, db, await row(id), ORIGIN);

    expect(failed.status).toBe("failed");
    expect(fal.submit).toHaveBeenCalledTimes(1);
    expect(await balance(user.id)).toBe(10);
  });

  it("charges two upscale credits for 8K", async () => {
    const { user, project } = await setup();
    const response = await createRender(project.id, { highRes: { target: "8k" } });

    expect(response.status).toBe(201);
    expect(await balance(user.id)).toBe(7);
  });

  it("refuses an output resolution on an edit", async () => {
    const { project } = await setup();
    const response = await createRender(project.id, { highRes: { target: "4k" }, edit: { mode: "prompt", method: "prompt" } });

    expect(response.status).toBe(422);
  });

  it("makes both copies in mock mode", async () => {
    const { project } = await setup("mock");
    const id = await create4k(project.id);
    const created = await row(id);
    expect(created.costMicros).toBe(0);

    await db.update(schema.renders).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(schema.renders.id, id));
    const done = await refreshRender(env, db, await row(id), ORIGIN);

    expect(done.status).toBe("succeeded");
    expect(done.resultImageUrl).toBe(`${ORIGIN}/api/uploads/u/source.jpg`);
    expect(done.settings?.highRes?.imageUrl).toBe(`${ORIGIN}/api/uploads/renders/${id}-4k.jpg`);
    expect(await sharp(objects.get(`renders/${id}-4k.jpg`)!).metadata()).toMatchObject({ width: 3840, height: 2880, format: "jpeg" });
  });
});
