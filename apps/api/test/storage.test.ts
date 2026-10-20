import { eq } from "drizzle-orm";
import sharp from "sharp";
import { schema } from "@renvia/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminOverviewResponse, AdminSettings } from "@renvia/types";
import { deleteObject, linkExpiry, putObject, signedUploadUrl, storageUsage } from "../src/lib/storage.js";
import { adminEnv, callAdmin, root } from "./support/admin.js";
import { callApi } from "./support/api.js";
import { db, makeProject, makeUser } from "./support/db.js";

// Object storage on Cloudflare R2's free tier: every write is recorded in storage_objects, new
// work is refused before stored bytes pass the cap, and image links stay stable so browsers
// cache them instead of downloading every image on every view.
vi.mock("@clerk/backend", async () => (await import("./support/clerkStub.js")).clerkStub());

/**
 * An in-memory bucket behind the S3 client's calls. The client is the real one with only `send`
 * replaced, so presigned links to the bucket are still signed as in production.
 */
const bucket = vi.hoisted(() => new Map<string, { body: Uint8Array; contentType: string }>());
vi.mock("@aws-sdk/client-s3", async () => {
  const actual = await vi.importActual<typeof import("@aws-sdk/client-s3")>("@aws-sdk/client-s3");
  class S3Client extends actual.S3Client {
    override async send(command: { constructor: { name: string }; input: { Key: string; Body?: Uint8Array; ContentType?: string } }) {
      const { Key, Body, ContentType } = command.input;
      if (command instanceof actual.PutObjectCommand) {
        bucket.set(Key, { body: Body!, contentType: ContentType! });
        return {};
      }
      if (command instanceof actual.GetObjectCommand) {
        const object = bucket.get(Key);
        if (!object) throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
        return { Body: { transformToWebStream: () => new Blob([new Uint8Array(object.body)]).stream() }, ContentType: object.contentType };
      }
      if (command instanceof actual.HeadObjectCommand) {
        if (!bucket.has(Key)) throw Object.assign(new Error("missing"), { name: "NotFound" });
        return {};
      }
      if (command instanceof actual.DeleteObjectCommand) {
        bucket.delete(Key);
        return {};
      }
      throw new Error(`Unexpected ${command.constructor.name}`);
    }
  }
  return { ...actual, S3Client };
});

const env = { ...adminEnv, STORAGE_BUCKET: "renviadb", STORAGE_ENDPOINT: "https://r2.test", STORAGE_ACCESS_KEY_ID: "k", STORAGE_SECRET_ACCESS_KEY: "s" };
const MB = 1_000_000;
const buffer = (bytes: number) => new Uint8Array(bytes).buffer;

beforeEach(async () => {
  bucket.clear();
  await db.insert(schema.billingPlans).values({ slug: "starter", name: "Starter", description: "Starter plan" });
  await db.insert(schema.appSettings).values({ id: 1, falMode: "mock", dailyRenderLimit: null, maxProjectsPerUser: null });
  await makeUser({ clerkId: "admin", email: "admin@renvia.test", role: "admin" });
  await makeUser({ clerkId: "customer", email: "customer@example.test", creditBalance: 20 });
});

/** Pretend `bytes` are already stored, without writing anything. */
const alreadyStored = (bytes: number) => db.insert(schema.storageObjects).values({ key: "renders/existing.jpg", bytes, contentType: "image/jpeg", kind: "render" });

describe("image links", () => {
  it("stay the same within a window, so the browser can reuse its copy", async () => {
    const now = 1_800_000_000;
    const ttl = 7 * 24 * 60 * 60;
    expect(linkExpiry(ttl, now)).toBe(linkExpiry(ttl, now + 60));
    expect(linkExpiry(ttl, now)).toBeGreaterThanOrEqual(now + ttl);
    expect(linkExpiry(ttl, now)).toBeLessThan(now + ttl + ttl / 12);
    expect(await signedUploadUrl(env, "http://localhost", "u/a.jpg")).toBe(await signedUploadUrl(env, "http://localhost", "u/a.jpg"));
  });

  it("are served with a private cache lifetime matching the link", async () => {
    await putObject(env, "u/a.jpg", buffer(10), "image/jpeg");
    const url = await signedUploadUrl(env, "http://localhost", "u/a.jpg");
    const response = await root.request(url, {}, env);

    // A redirect straight to the bucket, cacheable privately for as long as the link lasts.
    expect(response.status).toBe(302);
    const cache = response.headers.get("cache-control")!;
    expect(cache).toMatch(/^private, max-age=\d+$/);
    expect(Number(/max-age=(\d+)/.exec(cache)![1])).toBeGreaterThan(6 * 24 * 60 * 60);
    const direct = new URL(response.headers.get("location")!);
    expect(direct.origin + direct.pathname).toBe("https://r2.test/renviadb/u/a.jpg");
    expect(direct.searchParams.get("X-Amz-Signature")).toBeTruthy();
    // The bucket's response carries the same private, immutable caching.
    expect(direct.searchParams.get("response-cache-control")).toMatch(/^private, max-age=\d+, immutable$/);
  });
});

describe("the storage ledger", () => {
  it("records every write by kind and forgets deleted objects", async () => {
    await putObject(env, "elevations/customer/a.jpg", buffer(3 * MB), "image/jpeg");
    await putObject(env, "renders/r1.jpg", buffer(2 * MB), "image/jpeg");
    await putObject(env, "watermarked/renders/r1.jpg", buffer(1 * MB), "image/jpeg");
    // Rewriting a key replaces its size rather than adding to it.
    await putObject(env, "renders/r1.jpg", buffer(4 * MB), "image/jpeg");

    expect(await storageUsage(db)).toEqual({ usedBytes: 8 * MB, objects: 3, byKind: { upload: 3 * MB, render: 4 * MB, watermark: 1 * MB, feedback: 0, stock: 0, thumbnail: 0 } });

    await deleteObject(env, "renders/r1.jpg");
    expect((await storageUsage(db)).usedBytes).toBe(4 * MB);
    expect(bucket.has("renders/r1.jpg")).toBe(false);
  });
});

describe("the storage cap", () => {
  beforeEach(() => db.update(schema.appSettings).set({ storageCapMb: 100 }));

  it("refuses an upload that would pass it, and stores nothing", async () => {
    await alreadyStored(99.5 * MB);
    const image = await sharp({ create: { width: 900, height: 900, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 60 } } }).png().toBuffer();
    expect(image.byteLength).toBeGreaterThan(0.5 * MB);

    const res = await root.request("http://localhost/api/uploads", { method: "POST", headers: { Authorization: "Bearer customer", "Content-Type": "image/png" }, body: new Uint8Array(image) }, env);

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "storage_full" });
    expect(bucket.size).toBe(0);
  });

  it("accepts an upload that fits", async () => {
    // A real image: uploads are decoded and compressed before they are stored.
    const image = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#808080" } }).png().toBuffer();
    const res = await root.request("http://localhost/api/uploads", { method: "POST", headers: { Authorization: "Bearer customer", "Content-Type": "image/png" }, body: new Uint8Array(image) }, env);
    expect(res.status).toBe(201);
    expect(bucket.size).toBe(1);
    const [stored] = [...bucket.values()];
    expect((await storageUsage(db)).usedBytes).toBe(stored!.body.byteLength);
  });

  it("refuses a render whose result might not fit, before charging for it", async () => {
    await alreadyStored(97 * MB);
    const [customer] = await db.select().from(schema.users).where(eq(schema.users.clerkId, "customer"));
    const project = await makeProject(customer!.id);
    const res = await callApi("customer", "POST", "/renders", {
      projectId: project.id, sourceImageUrl: "http://localhost/api/uploads/u/source.jpg", prompt: "dusk", aspectRatio: "auto", style: "Photorealistic", generationSettings: { sourceType: "photo" },
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "storage_full" });
    expect((await db.select().from(schema.users).where(eq(schema.users.clerkId, "customer")))[0]!.creditBalance).toBe(20);
  });

  it("shows usage in Settings and warns on the Overview as it fills", async () => {
    await alreadyStored(95 * MB);
    const settings = (await (await callAdmin("admin", "GET", "/settings")).json()) as AdminSettings;
    expect(settings).toMatchObject({ storageCapMb: 100, storage: { usedBytes: 95 * MB, capBytes: 100 * MB, objects: 1, byKind: { render: 95 * MB } } });
    const overview = (await (await callAdmin("admin", "GET", "/overview")).json()) as AdminOverviewResponse;
    expect(overview.alerts.find((alert) => alert.id === "storage_critical")).toBeTruthy();
  });

  it("can't be set above the free 10 GB", async () => {
    expect((await callAdmin("admin", "PUT", "/settings", { storageCapMb: 10_001 })).status).toBe(400);
    expect((await callAdmin("admin", "PUT", "/settings", { storageCapMb: 9_500 })).status).toBe(200);
  });
});
