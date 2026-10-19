import { eq } from "drizzle-orm";
import sharp from "sharp";
import { schema } from "@renvia/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { publicUploadUrl, signedUploadUrl } from "../src/lib/storage.js";
import { resolveImageInput, ForeignRenderError } from "../src/lib/watermark.js";
import { adminEnv, root } from "./support/admin.js";
import { callApi } from "./support/api.js";
import { db, makeProject, makeRender, makeUser } from "./support/db.js";

// Free-plan model output is watermarked wherever it reaches the browser; paid plans see it
// clean, and inputs made from a watermarked render always use the clean original.
vi.mock("@clerk/backend", async () => (await import("./support/clerkStub.js")).clerkStub());

const objects = new Map<string, Uint8Array>();
vi.mock("../src/lib/storage.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/storage.js")>("../src/lib/storage.js");
  return {
    ...actual,
    getObject: vi.fn(async (_env: unknown, key: string) => {
      const bytes = objects.get(key);
      return bytes ? { body: new Blob([new Uint8Array(bytes)]).stream(), contentType: "image/png" } : null;
    }),
    putObject: vi.fn(async (_env: unknown, key: string, body: ArrayBuffer) => {
      objects.set(key, new Uint8Array(body));
    }),
    deleteObject: vi.fn(async (_env: unknown, key: string) => {
      objects.delete(key);
    }),
    objectExists: vi.fn(async (_env: unknown, key: string) => objects.has(key)),
    // Stored images are served as a redirect to the bucket; here the link just names the key.
    directObjectUrl: vi.fn(async (_env: unknown, key: string) => ({ url: `https://r2.test/${key}`, maxAge: 60 })),
  };
});

const ORIGIN = "http://localhost";
const keyOf = (url: string) => decodeURIComponent(new URL(url).pathname.replace("/api/uploads/", ""));

let fixture: Awaited<ReturnType<typeof seed>>;

async function seed() {
  objects.clear();
  const [, studio] = await db.insert(schema.billingPlans).values([
    { slug: "starter", name: "Starter", description: "Free", monthlyCredits: 20 },
    { slug: "studio", name: "Studio", description: "Paid", priceCents: 2900, interval: "month", monthlyCredits: 200 },
  ]).returning();
  const user = await makeUser({ clerkId: "customer", email: "customer@example.test", creditBalance: 10 });
  const project = await makeProject(user.id);
  const render = await makeRender(project.id, { status: "succeeded", sourceImageUrl: publicUploadUrl(ORIGIN, "elevations/customer/source.png") });
  const resultKey = `renders/${render.id}.png`;
  await db.update(schema.renders).set({ resultImageUrl: publicUploadUrl(ORIGIN, resultKey) }).where(eq(schema.renders.id, render.id));
  objects.set(resultKey, new Uint8Array(await sharp({ create: { width: 320, height: 200, channels: 3, background: "#7a8c99" } }).png().toBuffer()));
  return { user, project, render, resultKey, studio: studio! };
}

beforeEach(async () => {
  fixture = await seed();
});

const listRenders = async (clerkId = "customer") =>
  ((await (await callApi(clerkId, "GET", `/renders?projectId=${fixture.project.id}`)).json()) as { jobs: { resultImageUrl: string; sourceImageUrl: string }[] }).jobs;
const upgrade = () => db.update(schema.userEntitlements).set({ overridePlanId: fixture.studio.id }).where(eq(schema.userEntitlements.userId, fixture.user.id));
const fetchUpload = (url: string) => root.request(url, {}, adminEnv);

describe("links issued to the Studio", () => {
  it("watermarks a free-plan user's renders and leaves their own uploads clean", async () => {
    const [job] = await listRenders();
    expect(keyOf(job!.resultImageUrl)).toBe(`watermarked/${fixture.resultKey}`);
    expect(keyOf(job!.sourceImageUrl)).toBe("elevations/customer/source.png");
  });

  it("links the clean original once the user is on a paid plan, including earlier renders", async () => {
    await upgrade();
    const [job] = await listRenders();
    expect(keyOf(job!.resultImageUrl)).toBe(fixture.resultKey);
    // Clean originals get a short link, so a downgrade takes effect within hours: 12, plus up to
    // one hour of rounding that keeps the link stable enough for the browser to cache the image.
    const expires = Number(new URL(job!.resultImageUrl).searchParams.get("expires"));
    expect(expires - Date.now() / 1000).toBeLessThanOrEqual(13 * 60 * 60 + 5);
  });

  it("watermarks renders a canvas node holds, whichever link it was saved with", async () => {
    await db.insert(schema.canvasNodes).values({ id: crypto.randomUUID(), projectId: fixture.project.id, type: "image", data: { imageUrl: publicUploadUrl(ORIGIN, fixture.resultKey) } });
    const read = async () => ((await (await callApi("customer", "GET", `/canvas-nodes?projectId=${fixture.project.id}`)).json()) as { nodes: { data: { imageUrl: string } }[] }).nodes[0]!.data.imageUrl;

    expect(keyOf(await read())).toBe(`watermarked/${fixture.resultKey}`);
    await upgrade();
    expect(keyOf(await read())).toBe(fixture.resultKey);
  });
});

describe("serving watermarked copies", () => {
  it("makes the copy from the original on first open and stores it", async () => {
    const [job] = await listRenders();

    const res = await fetchUpload(job!.resultImageUrl);

    // Stored under the current design's version and served from the bucket.
    const stored = `watermarked-v3/${fixture.resultKey}`;
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://r2.test/${stored}`);
    const served = objects.get(stored)!;
    expect(Buffer.compare(Buffer.from(served), Buffer.from(objects.get(fixture.resultKey)!))).not.toBe(0);
    expect(await sharp(served).metadata()).toMatchObject({ width: 320, height: 200 });
  });

  it("names a watermarked thumbnail after the current design, never reusing an older one", async () => {
    const [job] = await listRenders();
    // A thumbnail made with an earlier design, under the old unversioned name.
    objects.set(`thumbs/watermarked/${fixture.resultKey}.webp`, new Uint8Array([1, 2, 3]));
    const url = new URL(job!.resultImageUrl);
    url.searchParams.set("size", "thumb");

    const res = await fetchUpload(url.toString());

    const thumbnail = `thumbs/watermarked-v3/${fixture.resultKey}.webp`;
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://r2.test/${thumbnail}`);
    expect(await sharp(objects.get(thumbnail)!).metadata()).toMatchObject({ format: "webp" });
    // Made from the current watermarked copy, which now exists too.
    expect(objects.has(`watermarked-v3/${fixture.resultKey}`)).toBe(true);
  });

  it("refuses unsigned links and watermarked keys that aren't model output", async () => {
    expect((await fetchUpload(publicUploadUrl(ORIGIN, `watermarked/${fixture.resultKey}`))).status).toBe(401);
    objects.set("elevations/customer/source.png", objects.get(fixture.resultKey)!);
    const notOutput = await signedUploadUrl(adminEnv, ORIGIN, "watermarked/elevations/customer/source.png");
    expect((await fetchUpload(notOutput)).status).toBe(404);
  });
});

describe("inputs made from renders", () => {
  it("swaps a watermarked link for the clean original of the user's own render", async () => {
    const [job] = await listRenders();
    expect(await resolveImageInput(db, fixture.user.id, job!.resultImageUrl, ORIGIN)).toBe(publicUploadUrl(ORIGIN, fixture.resultKey));

    const res = await callApi("customer", "POST", "/renders", {
      projectId: fixture.project.id,
      sourceImageUrl: job!.resultImageUrl,
      prompt: "",
      aspectRatio: "auto",
      style: "Photorealistic",
      generationSettings: { sourceType: "photo", referenceImageUrls: [job!.resultImageUrl] },
    });

    expect(res.status).toBe(201);
    const { job: created } = (await res.json()) as { job: { id: string } };
    const [row] = await db.select().from(schema.renders).where(eq(schema.renders.id, created.id));
    expect(keyOf(row!.sourceImageUrl)).toBe(fixture.resultKey);
    expect(row!.settings?.referenceImageUrls?.map(keyOf)).toEqual([fixture.resultKey]);
  });

  it("refuses another account's render as an input", async () => {
    const other = await makeUser({ clerkId: "other", email: "other@example.test", creditBalance: 10 });
    const [job] = await listRenders();

    await expect(resolveImageInput(db, other.id, job!.resultImageUrl, ORIGIN)).rejects.toBeInstanceOf(ForeignRenderError);
    const otherProject = await makeProject(other.id);
    const res = await callApi("other", "POST", "/renders", {
      projectId: otherProject.id, sourceImageUrl: publicUploadUrl(ORIGIN, fixture.resultKey), prompt: "", aspectRatio: "auto", style: "Photorealistic", generationSettings: { sourceType: "photo" },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "foreign_render" });
  });

  it("passes uploads and external links through unchanged", async () => {
    expect(await resolveImageInput(db, fixture.user.id, "https://example.test/a.jpg", ORIGIN)).toBe("https://example.test/a.jpg");
    const upload = publicUploadUrl(ORIGIN, "elevations/customer/source.png");
    expect(await resolveImageInput(db, fixture.user.id, upload, ORIGIN)).toBe(upload);
  });
});
