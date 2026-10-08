import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { schema } from "@renvia/db";
import { describe, expect, it, vi } from "vitest";
import { detectSourceType } from "../src/lib/sourceKind.js";
import { callApi } from "./support/api.js";
import { db, makeProject, makeUser, testEnv } from "./support/db.js";

// How the detector is used: reading our own uploads, and the real POST /api/renders route.
vi.mock("@clerk/backend", async () => (await import("./support/clerkStub.js")).clerkStub());

const objects = new Map<string, Uint8Array>();
vi.mock("../src/lib/storage.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/storage.js")>("../src/lib/storage.js");
  return {
    ...actual,
    getObject: vi.fn(async (_env: unknown, key: string) => {
      const bytes = objects.get(key);
      return bytes ? { body: new Blob([new Uint8Array(bytes)]).stream(), contentType: "image/jpeg" } : null;
    }),
  };
});

const fixtures = fileURLToPath(new URL("../../../tests/render-fidelity/fixtures/", import.meta.url));
const fixture = (dir: string, name: string) => new Uint8Array(readFileSync(join(fixtures, dir, name)));

describe("detectSourceType", () => {
  const env = testEnv();
  const origin = "http://localhost";
  const url = (key: string) => `${origin}/api/uploads/${key}`;

  it("reads one of our own uploads", async () => {
    objects.set("a/drawing.jpg", fixture("Test Elevation", "architectural elevation design.jpg"));
    objects.set("a/photo.jpg", fixture("Rendered Results", "Exterior - Detailed.jpeg"));
    expect(await detectSourceType(env, url("a/drawing.jpg"), origin)).toBe("drawing");
    expect(await detectSourceType(env, url("a/photo.jpg"), origin)).toBe("photo");
  });

  it("never fetches or analyses a client-supplied URL", async () => {
    const { getObject } = await import("../src/lib/storage.js");
    vi.mocked(getObject).mockClear();
    expect(await detectSourceType(env, "https://evil.example/photo.jpg", origin)).toBe("drawing");
    expect(getObject).not.toHaveBeenCalled();
  });

  it("falls back to a drawing for a missing object or unreadable bytes", async () => {
    objects.set("a/broken.jpg", new Uint8Array([1, 2, 3, 4]));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await detectSourceType(env, url("a/missing.jpg"), origin)).toBe("drawing");
    expect(await detectSourceType(env, url("a/broken.jpg"), origin)).toBe("drawing");
    vi.restoreAllMocks();
  });
});

describe("POST /api/renders", () => {
  async function submit(sourceKey: string, generationSettings?: Record<string, unknown>) {
    await db.insert(schema.billingPlans).values({ slug: "starter", name: "Starter", description: "Starter plan" });
    const user = await makeUser({ clerkId: "customer", email: "customer@example.test", creditBalance: 10 });
    const project = await makeProject(user.id);
    const response = await callApi("customer", "POST", "/renders", {
      projectId: project.id,
      sourceImageUrl: `http://localhost/api/uploads/${sourceKey}`,
      prompt: "",
      aspectRatio: "auto",
      style: "Photorealistic",
      ...(generationSettings ? { generationSettings } : {}),
    });
    expect(response.status).toBe(201);
    const { job } = (await response.json()) as { job: { id: string; settings: { sourceType?: string } | null } };
    const [row] = await db.select().from(schema.renders).where(eq(schema.renders.id, job.id));
    return { job, stored: row!.settings };
  }

  it("detects a drawing and a photo on its own and stores the result with the render", async () => {
    objects.set("u/elevation.jpg", fixture("Test Elevation", "architectural elevation design 2.jpg"));
    const drawing = await submit("u/elevation.jpg");
    expect(drawing.job.settings?.sourceType).toBe("drawing");
    expect(drawing.stored?.sourceType).toBe("drawing");
  });

  it("detects a photo", async () => {
    objects.set("u/house.jpg", fixture("test reference images", "lakeside-house.jpg"));
    const photo = await submit("u/house.jpg");
    expect(photo.stored?.sourceType).toBe("photo");
  });

  it("respects a source type the caller sends", async () => {
    objects.set("u/house.jpg", fixture("test reference images", "lakeside-house.jpg"));
    const forced = await submit("u/house.jpg", { sourceType: "drawing" });
    expect(forced.stored?.sourceType).toBe("drawing");
  });

  it("leaves edits alone", async () => {
    objects.set("u/house.jpg", fixture("test reference images", "lakeside-house.jpg"));
    const edit = await submit("u/house.jpg", { edit: { mode: "prompt" } });
    expect(edit.stored?.sourceType).toBeUndefined();
  });
});

