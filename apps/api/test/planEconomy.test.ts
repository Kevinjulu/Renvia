import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { asc, eq, sql } from "drizzle-orm";
import { schema } from "@renvia/db";
import { PLAN_ECONOMY } from "@renvia/types";
import { describe, expect, it } from "vitest";
import { db } from "./support/db.js";

// The plan economy: the numbers the migrations land on, the reference in @renvia/types, and the
// copy customers read must all say the same thing. Change one and these fail until the others follow.

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, root)), "utf8");

/** Each plan as migrations 0019, 0029 and 0034 left it, before 0045. */
interface PlanTerms {
  name: string;
  monthlyCredits: number;
  dailyRenderLimit: number;
  monthlyRenderLimit: number | null;
  maxProjects: number;
  concurrentRenderLimit: number;
}

const BEFORE_0045: Record<"starter" | "studio" | "team", PlanTerms> = {
  starter: { name: "Free", monthlyCredits: 20, dailyRenderLimit: 5, monthlyRenderLimit: 25, maxProjects: 2, concurrentRenderLimit: 1 },
  studio: { name: "Pro", monthlyCredits: 300, dailyRenderLimit: 60, monthlyRenderLimit: null, maxProjects: 50, concurrentRenderLimit: 3 },
  team: { name: "Premium", monthlyCredits: 1000, dailyRenderLimit: 250, monthlyRenderLimit: null, maxProjects: 500, concurrentRenderLimit: 8 },
};

async function seedPlans(overrides: Partial<Record<keyof typeof BEFORE_0045, Partial<PlanTerms>>> = {}) {
  for (const [slug, terms] of Object.entries(BEFORE_0045)) {
    const merged = { ...terms, ...overrides[slug as keyof typeof BEFORE_0045] };
    const [plan] = await db
      .insert(schema.billingPlans)
      .values({ slug, ...merged, description: `${merged.name} plan`, priceCents: slug === "starter" ? 0 : 2900, interval: slug === "starter" ? "none" : "month" })
      .returning();
    await db.insert(schema.billingPlanVersions).values({ planId: plan!.id, version: 1, terms: { name: merged.name } as never, reason: "Launch" });
  }
}

async function runMigration() {
  const file = read("packages/db/migrations/0045_plan_economy.sql");
  for (const statement of file.split("--> statement-breakpoint")) {
    if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

async function plans() {
  const rows = await db.select().from(schema.billingPlans);
  return Object.fromEntries(rows.map((row) => [row.slug, row]));
}

describe("migration 0045", () => {
  it("lands every plan on the economy in @renvia/types", async () => {
    await seedPlans();
    await db.insert(schema.appSettings).values({ id: 1, dailyRenderLimit: 5 });
    await runMigration();

    const after = await plans();
    for (const [slug, expected] of Object.entries(PLAN_ECONOMY)) {
      expect(after[slug], slug).toMatchObject(expected);
    }
    // The global fallback follows the Free plan's daily limit.
    expect((await db.select().from(schema.appSettings))[0]!.dailyRenderLimit).toBe(10);
  });

  it("records each changed plan as a new version, and leaves Premium alone", async () => {
    await seedPlans();
    await runMigration();

    const versions = await db.select().from(schema.billingPlanVersions).orderBy(asc(schema.billingPlanVersions.version));
    const byPlan = new Map<string, number[]>();
    const rows = await db.select({ id: schema.billingPlans.id, slug: schema.billingPlans.slug }).from(schema.billingPlans);
    for (const { id, slug } of rows) byPlan.set(slug, versions.filter((row) => row.planId === id).map((row) => row.version));
    expect(byPlan.get("starter")).toEqual([1, 2]);
    expect(byPlan.get("studio")).toEqual([1, 2]);
    expect(byPlan.get("team")).toEqual([1]);

    const [free] = await db.select().from(schema.billingPlans).where(eq(schema.billingPlans.slug, "starter"));
    const [latest] = versions.filter((row) => row.planId === free!.id && row.version === 2);
    expect(latest!.terms).toMatchObject({ dailyRenderLimit: 10, concurrentRenderLimit: 4, monthlyCredits: 20 });
  });

  it("keeps a figure an operator already changed", async () => {
    await seedPlans({ starter: { dailyRenderLimit: 7 }, studio: { concurrentRenderLimit: 5 } });
    await runMigration();

    const after = await plans();
    expect(after.starter).toMatchObject({ dailyRenderLimit: 7, concurrentRenderLimit: 4 });
    expect(after.studio).toMatchObject({ concurrentRenderLimit: 5 });
  });

  it("changes nothing, and adds no version, when run again", async () => {
    await seedPlans();
    await runMigration();
    await runMigration();
    expect(await db.select().from(schema.billingPlanVersions)).toHaveLength(5);
  });
});

describe("the copy customers read", () => {
  const pricing = read("apps/marketing/components/sections/Pricing.tsx");
  const faq = read("apps/marketing/components/sections/FAQ.tsx");

  it("states the Free plan's real numbers on the pricing page", () => {
    const free = PLAN_ECONOMY.starter;
    expect(pricing).toContain(`${free.monthlyCredits} free credits every month`);
    expect(pricing).toContain(`Start with ${free.monthlyCredits} free credits`);
    expect(pricing).toContain(`Up to ${free.dailyRenderLimit} renders per day`);
    expect(pricing).toContain(`${free.concurrentRenderLimit} renders at once`);
    expect(pricing).toContain(`${free.maxProjects} active projects`);
  });

  it("states Pro and Premium's real numbers on the pricing page", () => {
    expect(pricing).toContain(`${PLAN_ECONOMY.studio.monthlyCredits} credits every month`);
    expect(pricing).toContain(`${PLAN_ECONOMY.studio.concurrentRenderLimit} renders at once`);
    expect(pricing).toContain(`${PLAN_ECONOMY.studio.maxProjects} projects`);
    expect(pricing).toContain(`${PLAN_ECONOMY.team.monthlyCredits.toLocaleString("en-US")} credits every month`);
    expect(pricing).toContain(`${PLAN_ECONOMY.team.concurrentRenderLimit} renders at once`);
    expect(pricing).toContain(`${PLAN_ECONOMY.team.maxProjects} projects`);
  });

  it("never promises a different number of free credits", () => {
    expect(pricing).not.toMatch(/\b25 (real )?(rendering |free )?credits/);
    expect(faq).toContain(`${PLAN_ECONOMY.starter.monthlyCredits} free credits every month`);
  });

  it("keeps the monthly render limit under the credits that can pay for it only for paid plans", () => {
    // Free: 20 credits can't fund more than 20 one-credit renders, so its 25-render monthly limit is
    // headroom for purchased packs, never the binding limit on its own credits.
    expect(PLAN_ECONOMY.starter.monthlyRenderLimit).toBeGreaterThanOrEqual(PLAN_ECONOMY.starter.monthlyCredits);
    expect(PLAN_ECONOMY.starter.dailyRenderLimit).toBeLessThanOrEqual(PLAN_ECONOMY.starter.monthlyRenderLimit);
    // A project's four default elevations must fit in one go on every plan.
    for (const plan of Object.values(PLAN_ECONOMY)) expect(plan.concurrentRenderLimit).toBeGreaterThanOrEqual(4);
  });
});
