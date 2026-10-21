import { eq } from "drizzle-orm";
import sharp from "sharp";
import { schema } from "@renvia/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DESIGN_CATEGORIES, REFERENCE_CATEGORIES, SAMPLE_CATEGORIES, isDesignCategory, type ListStockReferencesResponse, type UseSampleDesignResponse } from "@renvia/types";
import { adminEnv, callAdmin, root } from "./support/admin.js";
import { callApi } from "./support/api.js";
import { db, makeUser } from "./support/db.js";

// Samples: reference images users attach by link, and original designs a new user can start a
// project from. A design is copied into the user's own storage so it can't be pulled out from
// under their project later.
vi.mock("@clerk/backend", async () => (await import("./support/clerkStub.js")).clerkStub());

const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
vi.mock("../src/lib/storage.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/storage.js")>("../src/lib/storage.js");
  return {
    ...actual,
    getObject: vi.fn(async (_env: unknown, key: string) => {
      const object = objects.get(key);
      return object ? { body: new Blob([new Uint8Array(object.bytes)]).stream(), contentType: object.contentType } : null;
    }),
    putObject: vi.fn(async (_env: unknown, key: string, body: ArrayBuffer, contentType: string) => {
      objects.set(key, { bytes: new Uint8Array(body), contentType });
    }),
  };
});

let png: Buffer;

beforeEach(async () => {
  objects.clear();
  png = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#b9a58a" } }).png().toBuffer();
  await db.insert(schema.billingPlans).values({ slug: "starter", name: "Free", description: "Free plan" });
  await db.insert(schema.appSettings).values({ id: 1, falMode: "mock", dailyRenderLimit: null, maxProjectsPerUser: null });
  await makeUser({ clerkId: "admin", email: "admin@example.test", role: "admin" });
  await makeUser({ clerkId: "customer", email: "customer@example.test", creditBalance: 20 });
});

/** A sample in storage and in the table, as the admin upload leaves it. */
async function seedSample(category: (typeof SAMPLE_CATEGORIES)[number]["key"], overrides: Partial<typeof schema.stockReferences.$inferInsert> = {}) {
  const key = `stock/${category}/${crypto.randomUUID()}.webp`;
  objects.set(key, { bytes: new Uint8Array(await sharp(png).webp().toBuffer()), contentType: "image/webp" });
  const [row] = await db.insert(schema.stockReferences).values({ category, key, caption: `${category} sample`, ...overrides }).returning();
  return row!;
}

const use = (id: string) => callApi("customer", "POST", `/references/stock/${id}/use`);

describe("sample categories", () => {
  it("keeps references and designs apart, and every category has one home", () => {
    const keys = SAMPLE_CATEGORIES.map((category) => category.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(REFERENCE_CATEGORIES.every((category) => !isDesignCategory(category.key))).toBe(true);
    expect(DESIGN_CATEGORIES.every((category) => isDesignCategory(category.key))).toBe(true);
    expect(DESIGN_CATEGORIES.map((category) => category.key)).toEqual(["design-3d", "design-photo", "design-drawing"]);
  });
});

describe("listing samples", () => {
  it("returns visible references and designs together, and leaves hidden ones out", async () => {
    await seedSample("windows");
    await seedSample("design-photo");
    await seedSample("design-drawing", { hidden: true });

    const response = await callApi("customer", "GET", "/references/stock");
    expect(response.status).toBe(200);
    const { references } = (await response.json()) as ListStockReferencesResponse;
    expect(references.map((item) => item.category).sort()).toEqual(["design-photo", "windows"]);
  });
});

describe("starting from a sample design", () => {
  it("copies the design into the user's own storage and charges it to their quota", async () => {
    const sample = await seedSample("design-3d");

    const response = await use(sample.id);
    expect(response.status).toBe(201);
    const { publicUrl } = (await response.json()) as UseSampleDesignResponse;

    const key = decodeURIComponent(new URL(publicUrl).pathname.replace(/^\/api\/uploads\//, ""));
    expect(key).toMatch(/^elevations\/customer\/.+\.webp$/);
    expect(objects.get(key)?.bytes).toEqual(objects.get(sample.key)?.bytes);

    const [row] = await db.select().from(schema.storageObjects).where(eq(schema.storageObjects.key, key));
    expect(row).toMatchObject({ kind: "upload" });
    expect(row!.bytes).toBe(objects.get(key)!.bytes.byteLength);
  });

  it("keeps working after the sample is hidden or deleted", async () => {
    const sample = await seedSample("design-photo");
    const { publicUrl } = (await (await use(sample.id)).json()) as UseSampleDesignResponse;
    const key = decodeURIComponent(new URL(publicUrl).pathname.replace(/^\/api\/uploads\//, ""));

    await db.delete(schema.stockReferences).where(eq(schema.stockReferences.id, sample.id));
    objects.delete(sample.key);
    expect(objects.has(key)).toBe(true);
    expect((await use(sample.id)).status).toBe(404);
  });

  it("only offers designs, not reference images, as an elevation", async () => {
    const sample = await seedSample("roof");
    const response = await use(sample.id);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "not_a_design" });
    expect(objects.size).toBe(1);
  });

  it("treats a hidden, unknown or malformed sample as not found", async () => {
    const hidden = await seedSample("design-photo", { hidden: true });
    expect((await use(hidden.id)).status).toBe(404);
    expect((await use(crypto.randomUUID())).status).toBe(404);
    expect((await use("not-a-uuid")).status).toBe(404);
  });

  it("needs a signed-in account", async () => {
    const sample = await seedSample("design-photo");
    expect((await callApi(null, "POST", `/references/stock/${sample.id}/use`)).status).toBe(401);
  });
});

describe("admin Samples", () => {
  const upload = (clerkId: string, category: string) =>
    root.request(
      `http://localhost/api/admin/library/${category}?caption=Two%20storey%20house`,
      { method: "POST", headers: { Authorization: `Bearer ${clerkId}`, "Content-Type": "image/png" }, body: new Uint8Array(png) },
      adminEnv,
    );

  it("accepts an upload into a design category and shows it to users", async () => {
    const response = await upload("admin", "design-drawing");
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ category: "design-drawing", caption: "Two storey house" });

    const { references } = (await (await callApi("customer", "GET", "/references/stock")).json()) as ListStockReferencesResponse;
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({ category: "design-drawing" });

    const listed = await callAdmin("admin", "GET", "/library");
    expect(((await listed.json()) as { references: unknown[] }).references).toHaveLength(1);
  });

  it("still takes the reference categories, and refuses an unknown one and non-admins", async () => {
    expect((await upload("admin", "windows")).status).toBe(201);
    expect((await upload("admin", "gardens")).status).toBeGreaterThanOrEqual(400);
    expect((await upload("customer", "design-photo")).status).toBe(403);
  });
});
