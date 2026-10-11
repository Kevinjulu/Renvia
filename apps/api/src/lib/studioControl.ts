import { and, desc, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { schema, type Database } from "@renvia/db";
import {
  defaultStudioConfig,
  featureDenial,
  STUDIO_FEATURES,
  type MaintenanceScope,
  type StudioConfig,
  type StudioFeatureAvailability,
  type StudioFeatureDenial,
  type StudioFeatureKey,
} from "@renvia/types";
import type { AppSettingsRow } from "./settings.js";

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

/** A complete config: every known feature has a rule, and nothing else is accepted. */
export const studioConfigSchema = z
  .object({ features: z.object(Object.fromEntries(FEATURE_KEYS.map((key) => [key, ruleSchema])) as Record<StudioFeatureKey, typeof ruleSchema>).strict() })
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
  return { features: { ...defaults.features, ...config.features } };
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
  plan: (label) => `${label} isn't included in your plan.`,
  rollout: (label) => `${label} isn't available on your account yet.`,
};

function labelFor(key: StudioFeatureKey): string {
  return STUDIO_FEATURES.find((feature) => feature.key === key)?.label ?? key;
}

/** What /me reports: each feature and whether this user can use it now. */
export function featureAvailability(config: StudioConfig, user: UserRow, planSlug: string): Record<StudioFeatureKey, StudioFeatureAvailability> {
  return Object.fromEntries(
    FEATURE_KEYS.map((key) => {
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
): Promise<FeatureRefusal | null> {
  if (bypasses(user)) return null;
  const observed: { featureKey: StudioFeatureKey; reason: StudioFeatureDenial }[] = [];
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
