import { asc, eq } from "drizzle-orm";
import { createDb, schema } from "@renvia/db";
import type { Env } from "../../src/index.js";
import { TEST_DATABASE_URL } from "./config.js";
import { getPool } from "./neonShim.js";

export const db = createDb(TEST_DATABASE_URL);

/** Fake bindings only: nothing here is a real credential. */
export function testEnv(overrides: Partial<Env> = {}): Env {
  return { DATABASE_URL: TEST_DATABASE_URL, ...overrides } as Env;
}

/** Empties every table so each test starts from a blank, fully-migrated schema. */
export async function resetDb(): Promise<void> {
  const pool = getPool(TEST_DATABASE_URL);
  const { rows } = await pool.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public'");
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"${r.tablename}"`).join(", ");
  await pool.query(`truncate ${tables} restart identity cascade`);
}

let counter = 0;
const next = () => ++counter;

export async function makeUser(overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  const n = next();
  const [user] = await db
    .insert(schema.users)
    .values({ clerkId: `clerk_${n}`, email: `user${n}@example.test`, ...overrides })
    .returning();
  return user!;
}

export async function makeProject(ownerId: string) {
  const [project] = await db.insert(schema.projects).values({ ownerId, name: `Project ${next()}` }).returning();
  return project!;
}

export async function makeRender(projectId: string, overrides: Partial<typeof schema.renders.$inferInsert> = {}) {
  const [render] = await db
    .insert(schema.renders)
    .values({ projectId, sourceImageUrl: "https://example.test/source.png", prompt: "test", ...overrides })
    .returning();
  return render!;
}

export async function makeSegmentation(userId: string, overrides: Partial<typeof schema.segmentations.$inferInsert> = {}) {
  const [segmentation] = await db
    .insert(schema.segmentations)
    .values({ userId, imageUrl: "https://example.test/source.png", model: "mock", ...overrides })
    .returning();
  return segmentation!;
}

export async function makeCreditPack(overrides: Partial<typeof schema.creditPacks.$inferInsert> = {}) {
  const [pack] = await db
    .insert(schema.creditPacks)
    .values({ sku: `pack_${next()}`, name: "Starter", priceCents: 1000, credits: 50, ...overrides })
    .returning();
  return pack!;
}

/** A PayPal credit-pack checkout waiting for its capture, keyed by the PayPal order ID. */
export async function makePaypalCheckout(
  userId: string,
  creditPackId: string,
  overrides: Partial<typeof schema.billingCheckouts.$inferInsert> = {},
) {
  const [checkout] = await db
    .insert(schema.billingCheckouts)
    .values({
      userId,
      creditPackId,
      kind: "credit_pack",
      provider: "paypal",
      providerCheckoutId: `ORDER-${next()}`,
      status: "pending",
      currency: "USD",
      amountCents: 1000,
      ...overrides,
    })
    .returning();
  return checkout!;
}

export async function balanceOf(userId: string): Promise<number> {
  const [row] = await db.select({ creditBalance: schema.users.creditBalance }).from(schema.users).where(eq(schema.users.id, userId));
  return row!.creditBalance;
}

export function ledgerFor(userId: string) {
  return db.select().from(schema.creditLedger).where(eq(schema.creditLedger.userId, userId)).orderBy(asc(schema.creditLedger.createdAt));
}
