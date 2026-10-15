import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { schema, type Database } from "@renvia/db";
import {
  defaultStudioConfig,
  featureDenial,
  legacyCreditPrices,
  planIncludesFeature,
  STUDIO_FEATURES,
  type CreditPrices,
  type RenderEngineMode,
  type RenderRoute,
  type MaintenanceScope,
  type StudioConfig,
  type StudioFeatureAvailability,
  type StudioFeatureDenial,
  type StudioFeatureKey,
} from "@renvia/types";
import type { AppSettingsRow } from "./settings.js";
import { modelFor } from "./models.js";
import { SAM_CLICK_MODEL_ID, SAM_MODEL_ID } from "./segment.js";

export type StudioRevisionRow = typeof schema.studioConfigRevisions.$inferSelect;
type UserRow = typeof schema.users.$inferSelect;

const FEATURE_KEYS = STUDIO_FEATURES.map((feature) => feature.key) as [StudioFeatureKey, ...StudioFeatureKey[]];

const ruleSchema = z
  .object({
    enabled: z.boolean(),
    enforcement: z.enum(["enforce", "observe"]),
    allowedPlans: z.array(z.string().trim().min(1).max(50)).max(20).nullable(),
    rolloutPercent: z.number().int().min(0).max(100),
    message: z.string().trim().max(280).nullable(),
  })
  .strict();

const price = z.number().int().min(0).max(1000);
const creditPricesSchema = z
  .object({ render: price, references: price, fidelity: price, editPass: price, upscale4k: price, upscale8k: price, selection: price })
  .strict();
const modelRuleSchema = z.object({ paused: z.boolean(), message: z.string().trim().max(280).nullable() }).strict();

/**
 * A complete config: every known feature has a rule, and nothing else is accepted. Prices and
 * model holds are optional, so revisions published before they existed stay valid as stored.
 */
export const studioConfigSchema = z
  .object({
    features: z.object(Object.fromEntries(FEATURE_KEYS.map((key) => [key, ruleSchema])) as Record<StudioFeatureKey, typeof ruleSchema>).strict(),
    credits: creditPricesSchema.nullable().optional(),
    models: z.record(z.string().min(1).max(200), modelRuleSchema).optional(),
  })
  .strict();

/** JSON with object keys sorted, so equal configs always hash and compare the same (jsonb reorders keys). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function configChecksum(config: StudioConfig): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(config)));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * A stored config with any feature it predates filled in as on. A feature added after a revision
 * was published therefore keeps working exactly as it did before Studio Control knew about it.
 */
export function normalizeConfig(config: StudioConfig): StudioConfig {
  const defaults = defaultStudioConfig();
  return { ...config, features: { ...defaults.features, ...config.features } };
}

/** The prices a revision published, or null when it left pricing to Settings. */
export async function publishedPricesFor(db: Database, version: number | null): Promise<CreditPrices | null> {
  if (version === null) return null;
  const [row] = await db.select({ config: schema.studioConfigRevisions.config }).from(schema.studioConfigRevisions).where(eq(schema.studioConfigRevisions.version, version)).limit(1);
  return row?.config.credits ?? null;
}

/** Prices charged under this config: the published ones, else Settings' per-image multipliers. */
export function effectiveCreditPrices(config: StudioConfig, settings: AppSettingsRow): CreditPrices {
  return config.credits ?? legacyCreditPrices(settings.creditsPerImage, settings.creditsPerSelection);
}

/** The routes each feature runs on, to find the models behind it. */
const FEATURE_ROUTES: Record<StudioFeatureKey, (RenderRoute | SelectionRoute)[]> = {
  "render.standard": ["photo", "drawing"],
  "render.references": ["references"],
  "render.fidelity": ["fidelity"],
  "edit.standard": ["edit"],
  "edit.references": ["edit-references"],
  "render.upscale": ["upscale"],
  "export.4k": ["upscale"],
  "export.8k": ["upscale"],
  "selection.click": ["selection-click"],
  "selection.prompt": ["selection"],
};

/** Typed selection runs on SAM 3, click selection on SAM 2. */
export type SelectionRoute = "selection" | "selection-click";

/** The model serving a route in this engine mode (selections use SAM outside mock mode). */
export function modelForRoute(mode: RenderEngineMode, route: RenderRoute | SelectionRoute): string {
  if (route === "selection") return mode === "mock" ? "mock" : SAM_MODEL_ID;
  if (route === "selection-click") return mode === "mock" ? "mock" : SAM_CLICK_MODEL_ID;
  return modelFor(mode, route).id;
}

export function featureModels(mode: RenderEngineMode, key: StudioFeatureKey): string[] {
  return [...new Set(FEATURE_ROUTES[key].map((route) => modelForRoute(mode, route)))];
}

/** The hold on a model behind this feature, if one of them is paused in this mode. */
function pausedModel(config: StudioConfig, mode: RenderEngineMode, key: StudioFeatureKey) {
  for (const id of featureModels(mode, key)) {
    const rule = config.models?.[id];
    if (rule?.paused) return rule;
  }
  return null;
}

/**
 * The Studio configuration in force: the latest published revision. Created as version 1 from
 * the defaults the first time it's asked for. Read once per request, so a request's feature
 * checks and the version stamped on its job always come from the same revision.
 */
export async function currentStudioRevision(db: Database): Promise<StudioRevisionRow & { config: StudioConfig }> {
  const [latest] = await db.select().from(schema.studioConfigRevisions).orderBy(desc(schema.studioConfigRevisions.version)).limit(1);
  if (latest) return { ...latest, config: normalizeConfig(latest.config) };
  const config = defaultStudioConfig();
  await db
    .insert(schema.studioConfigRevisions)
    .values({ version: 1, config, checksum: await configChecksum(config), reason: "Initial configuration: every feature on for every plan" })
    .onConflictDoNothing();
  return currentStudioRevision(db);
}

/** Admins see every feature, so they can try out something that is off for customers. */
function bypasses(user: UserRow): boolean {
  return user.role === "admin";
}

const DEFAULT_MESSAGES: Record<StudioFeatureDenial, (label: string) => string> = {
  disabled: (label) => `${label} is switched off for now.`,
  paused: (label) => `${label} is paused while we look into a problem.`,
  plan: (label) => `${label} isn't included in your plan.`,
  rollout: (label) => `${label} isn't available on your account yet.`,
};

/** For a feature outside the user's plan (see PLAN_FEATURES), which no rule can switch on. */
const PLAN_MESSAGE = (label: string) => `${label} comes with a paid plan. Upgrade to use it.`;

function labelFor(key: StudioFeatureKey): string {
  return STUDIO_FEATURES.find((feature) => feature.key === key)?.label ?? key;
}

/** What /me reports: each feature and whether this user can use it now. */
export function featureAvailability(config: StudioConfig, user: UserRow, planSlug: string, mode: RenderEngineMode): Record<StudioFeatureKey, StudioFeatureAvailability> {
  return Object.fromEntries(
    FEATURE_KEYS.map((key) => {
      const paused = bypasses(user) ? null : pausedModel(config, mode, key);
      if (paused) return [key, { available: false, reason: "paused", message: paused.message ?? DEFAULT_MESSAGES.paused(labelFor(key)) }];
      if (!bypasses(user) && !planIncludesFeature(planSlug, key)) return [key, { available: false, reason: "plan", message: PLAN_MESSAGE(labelFor(key)) }];
      const rule = config.features[key];
      const denial = bypasses(user) ? null : featureDenial(rule, { id: user.id, planSlug }, key);
      // An observe-mode rule never refuses, so the feature is available.
      if (!denial || rule.enforcement === "observe") return [key, { available: true, reason: null, message: null }];
      return [key, { available: false, reason: denial, message: rule.message ?? DEFAULT_MESSAGES[denial](labelFor(key)) }];
    }),
  ) as Record<StudioFeatureKey, StudioFeatureAvailability>;
}

export interface FeatureRefusal {
  code: "feature_disabled";
  error: string;
  status: 403;
  feature: StudioFeatureKey;
  reason: StudioFeatureDenial;
}

/**
 * Checks the features a request uses against the revision in force. Returns the first enforced
 * refusal, or null. Rules in observe mode never refuse; what they would have refused is logged
 * for the Studio Control page instead, and a logging failure never blocks the request.
 */
export async function checkFeatures(
  db: Database,
  revision: { version: number; config: StudioConfig },
  user: UserRow,
  planSlug: string,
  keys: StudioFeatureKey[],
  mode: RenderEngineMode,
): Promise<FeatureRefusal | null> {
  if (bypasses(user)) return null;
  // A paused model stops every request that would use it; there is no observe mode for that.
  for (const key of keys) {
    const paused = pausedModel(revision.config, mode, key);
    if (paused) return { code: "feature_disabled", error: paused.message ?? DEFAULT_MESSAGES.paused(labelFor(key)), status: 403, feature: key, reason: "paused" };
  }
  // Nor is there for a feature the user's plan doesn't include.
  for (const key of keys) {
    if (!planIncludesFeature(planSlug, key)) return { code: "feature_disabled", error: PLAN_MESSAGE(labelFor(key)), status: 403, feature: key, reason: "plan" };
  }
  const observed: { featureKey: StudioFeatureKey; reason: Exclude<StudioFeatureDenial, "paused"> }[] = [];
  let refusal: FeatureRefusal | null = null;
  for (const key of keys) {
    const rule = revision.config.features[key];
    const denial = featureDenial(rule, { id: user.id, planSlug }, key);
    if (!denial) continue;
    if (rule.enforcement === "observe") {
      observed.push({ featureKey: key, reason: denial });
      continue;
    }
    refusal ??= { code: "feature_disabled", error: rule.message ?? DEFAULT_MESSAGES[denial](labelFor(key)), status: 403, feature: key, reason: denial };
  }
  if (observed.length > 0) {
    try {
      await db.insert(schema.studioFeatureObservations).values(observed.map((row) => ({ ...row, userId: user.id, configVersion: revision.version })));
    } catch (error) {
      console.error("feature observation not recorded", error);
    }
  }
  return refusal;
}

export type MaintenanceWindowRow = typeof schema.maintenanceWindows.$inferSelect;

export interface EffectiveMaintenance {
  renders: boolean;
  selections: boolean;
  /** The active window's message, else the switches' message. */
  message: string | null;
  /** The window running now or starting next, if any. */
  next: MaintenanceWindowRow | null;
}

function covers(scope: MaintenanceScope, kind: "renders" | "selections"): boolean {
  return scope === "all" || scope === kind;
}

/**
 * Maintenance as it stands now: the Settings switches, plus any scheduled window whose time has
 * come. Windows are judged by their times on every call, so none has to be switched on or off.
 */
export async function effectiveMaintenance(db: Database, settings: AppSettingsRow, now = new Date()): Promise<EffectiveMaintenance> {
  const windows = await db
    .select()
    .from(schema.maintenanceWindows)
    .where(and(isNull(schema.maintenanceWindows.cancelledAt), gt(schema.maintenanceWindows.endsAt, now)))
    .orderBy(schema.maintenanceWindows.startsAt)
    .limit(20);
  const active = windows.filter((window) => window.startsAt <= now);
  const renders = settings.maintenanceRenders || active.some((window) => covers(window.scope, "renders"));
  const selections = settings.maintenanceSegments || active.some((window) => covers(window.scope, "selections"));
  return {
    renders,
    selections,
    message: active.find((window) => window.message)?.message ?? settings.maintenanceMessage,
    next: windows[0] ?? null,
  };
}
