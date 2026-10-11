import { Hono, type Context } from "hono";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Database } from "@renvia/db";
import {
  STUDIO_FEATURES,
  type AdminStudioControlResponse,
  type MaintenanceWindow,
  type StudioConfig,
  type StudioConfigRevision,
  type StudioFeatureDenial,
  type StudioFeatureKey,
} from "@renvia/types";
import { getSettings } from "../../lib/settings.js";
import { canonicalJson, configChecksum, currentStudioRevision, normalizeConfig, studioConfigSchema, type MaintenanceWindowRow, type StudioRevisionRow } from "../../lib/studioControl.js";
import { denyUnless } from "./permissions.js";
import { governance, requestApproval } from "./governance.js";
import { adminEventInsert } from "./shared.js";
import type { AdminContext } from "./context.js";

export const studioControlRoutes = new Hono<AdminContext>();

/** Longest a single maintenance window may run. */
const MAX_WINDOW_DAYS = 7;

function toRevision(row: StudioRevisionRow, emails: Map<string, string>): StudioConfigRevision {
  return {
    version: row.version,
    checksum: row.checksum,
    reason: row.reason,
    publishedByEmail: row.publishedBy ? emails.get(row.publishedBy) ?? null : null,
    restoredFrom: row.restoredFrom,
    approvalId: row.approvalId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toMaintenanceWindow(row: MaintenanceWindowRow, emails: Map<string, string>, now = new Date()): MaintenanceWindow {
  const state = row.cancelledAt ? "cancelled" : row.endsAt <= now ? "ended" : row.startsAt <= now ? "active" : "upcoming";
  return {
    id: row.id,
    scope: row.scope,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    message: row.message,
    reason: row.reason,
    createdByEmail: emails.get(row.createdBy) ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelledByEmail: row.cancelledBy ? emails.get(row.cancelledBy) ?? null : null,
    createdAt: row.createdAt.toISOString(),
    state,
  };
}

async function emailsFor(db: Database, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map<string, string>();
  const rows = await db.select({ id: schema.users.id, email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, unique));
  return new Map(rows.map((row) => [row.id, row.email]));
}

studioControlRoutes.get("/studio-control", async (c) => {
  const denied = denyUnless(c, "studio.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const current = await currentStudioRevision(db);
  const [revisions, plans, observations, windows, approvals, settings] = await Promise.all([
    db.select().from(schema.studioConfigRevisions).orderBy(desc(schema.studioConfigRevisions.version)).limit(25),
    db.select({ slug: schema.billingPlans.slug, name: schema.billingPlans.name }).from(schema.billingPlans).where(eq(schema.billingPlans.isActive, true)).orderBy(asc(schema.billingPlans.priceCents)),
    db
      .select({
        key: schema.studioFeatureObservations.featureKey,
        reason: schema.studioFeatureObservations.reason,
        last24h: sql<number>`count(*) filter (where ${schema.studioFeatureObservations.createdAt} >= now() - interval '24 hours')::int`,
        last7d: sql<number>`count(*)::int`,
        users7d: sql<number>`count(distinct ${schema.studioFeatureObservations.userId})::int`,
      })
      .from(schema.studioFeatureObservations)
      .where(gte(schema.studioFeatureObservations.createdAt, sql`now() - interval '7 days'`))
      .groupBy(schema.studioFeatureObservations.featureKey, schema.studioFeatureObservations.reason),
    // Everything still to come or running, plus the most recent finished ones.
    db.select().from(schema.maintenanceWindows).where(gte(schema.maintenanceWindows.endsAt, sql`now() - interval '30 days'`)).orderBy(desc(schema.maintenanceWindows.startsAt)).limit(30),
    db
      .select()
      .from(schema.approvalRequests)
      .where(and(inArray(schema.approvalRequests.action, ["studio_change", "maintenance_window"]), inArray(schema.approvalRequests.status, ["pending", "approved"])))
      .orderBy(desc(schema.approvalRequests.createdAt)),
    getSettings(db),
  ]);
  const emails = await emailsFor(db, [...revisions.map((row) => row.publishedBy), ...windows.flatMap((row) => [row.createdBy, row.cancelledBy])]);
  const response: AdminStudioControlResponse = {
    current: { ...toRevision(current, emails), config: current.config },
    revisions: revisions.map((row) => toRevision(row, emails)),
    features: STUDIO_FEATURES,
    plans,
    observations: observations.map((row) => ({ key: row.key as StudioFeatureKey, reason: row.reason as StudioFeatureDenial, last24h: row.last24h, last7d: row.last7d, users7d: row.users7d })),
    maintenance: {
      switches: { renders: settings.maintenanceRenders, selections: settings.maintenanceSegments, message: settings.maintenanceMessage },
      windows: windows.map((row) => toMaintenanceWindow(row, emails)),
    },
    pendingApprovals: approvals.map((row) => ({ id: row.id, action: row.action, status: row.status as "pending" | "approved", reason: row.reason, createdAt: row.createdAt.toISOString() })),
  };
  return c.json(response);
});

/** Plain-language list of what changes between two configs, for the audit trail. */
export function describeConfigChange(before: StudioConfig, after: StudioConfig) {
  return STUDIO_FEATURES.flatMap(({ key, label }) => {
    const from = before.features[key];
    const to = after.features[key];
    return canonicalJson(from) === canonicalJson(to) ? [] : [{ key, label, before: from, after: to }];
  });
}

export type PublishOutcome =
  | { ok: true; version: number; checksum: string }
  | { ok: false; status: 400 | 409; error: string; code: string };

/**
 * Publishes `config` as the next version, or reports why it can't. The expected version makes a
 * stale editor fail instead of overwriting a newer publish; the version primary key settles two
 * simultaneous publishes. Revision and audit row commit together.
 */
export async function publishStudioConfig(
  db: Database,
  input: { expectedVersion: number; config: StudioConfig; reason: string; actorId: string; restoredFrom?: number | null; approvalId?: string | null },
): Promise<PublishOutcome> {
  const parsed = studioConfigSchema.safeParse(input.config);
  if (!parsed.success) return { ok: false, status: 400, error: "That configuration isn't valid", code: "invalid_config" };
  const config = parsed.data as StudioConfig;
  const planSlugs = new Set((await db.select({ slug: schema.billingPlans.slug }).from(schema.billingPlans)).map((plan) => plan.slug));
  const unknownPlan = Object.values(config.features).flatMap((rule) => rule.allowedPlans ?? []).find((slug) => !planSlugs.has(slug));
  if (unknownPlan) return { ok: false, status: 400, error: `No plan "${unknownPlan}"`, code: "invalid_config" };

  const current = await currentStudioRevision(db);
  if (current.version !== input.expectedVersion) {
    return { ok: false, status: 409, error: `Version ${current.version} was published after you started. Reload and make your change again.`, code: "config_version_conflict" };
  }
  const checksum = await configChecksum(config);
  if (checksum === current.checksum) return { ok: false, status: 400, error: "Nothing has changed", code: "no_changes" };

  const version = current.version + 1;
  const changes = describeConfigChange(current.config, config);
  try {
    await db.batch([
      db.insert(schema.studioConfigRevisions).values({ version, config, checksum, reason: input.reason, publishedBy: input.actorId, restoredFrom: input.restoredFrom ?? null, approvalId: input.approvalId ?? null }),
      adminEventInsert(db, {
        actorId: input.actorId,
        action: "studio.publish",
        targetType: "studio_config",
        targetId: String(version),
        summary: input.restoredFrom
          ? `Restored Studio configuration v${input.restoredFrom} as v${version}`
          : `Published Studio configuration v${version}: ${changes.map((change) => change.label).join(", ")}`,
        detail: { reason: input.reason, fromVersion: current.version, version, checksum, changes, ...(input.approvalId ? { approvalId: input.approvalId } : {}) },
      }),
    ]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, status: 409, error: "Another version was published at the same moment. Reload and try again.", code: "config_version_conflict" };
    }
    throw error;
  }
  return { ok: true, version, checksum };
}

/** Publishes now, or holds the change for a second admin when the Studio rule is on. */
async function publishOrRequest(c: Context<AdminContext>, input: { expectedVersion: number; config: StudioConfig; reason: string; restoredFrom?: number | null }) {
  const db = c.get("db"); const actor = c.get("admin");
  const rules = await governance(db);
  if (rules.studioChangeApprovalThreshold > 0 && 1 >= rules.studioChangeApprovalThreshold) {
    // Validate now so nobody approves something that can never publish.
    const parsed = studioConfigSchema.safeParse(input.config);
    if (!parsed.success) return c.json({ error: "That configuration isn't valid", code: "invalid_config" }, 400);
    const current = await currentStudioRevision(db);
    if (current.version !== input.expectedVersion) return c.json({ error: `Version ${current.version} was published after you started. Reload and make your change again.`, code: "config_version_conflict" }, 409);
    const approval = await requestApproval(db, {
      action: "studio_change", actorId: actor.id, targetType: "studio_config", targetId: String(input.expectedVersion + 1),
      riskValue: 1, threshold: rules.studioChangeApprovalThreshold, reason: input.reason,
      payload: { expectedVersion: input.expectedVersion, config: parsed.data, reason: input.reason, restoredFrom: input.restoredFrom ?? null, changes: describeConfigChange(current.config, parsed.data as StudioConfig).map((change) => change.label) },
    });
    return c.json({ pendingApproval: true, approvalId: approval.id }, 202);
  }
  const outcome = await publishStudioConfig(db, { ...input, actorId: actor.id });
  if (!outcome.ok) return c.json({ error: outcome.error, code: outcome.code }, outcome.status);
  return c.json({ version: outcome.version, checksum: outcome.checksum });
}

const reasonSchema = z.string().trim().min(1).max(300);

studioControlRoutes.post("/studio-control/publish", async (c) => {
  const denied = denyUnless(c, "studio.manage"); if (denied) return c.json(denied, 403);
  const body = z.object({ expectedVersion: z.number().int().positive(), config: z.unknown(), reason: reasonSchema }).parse(await c.req.json());
  return publishOrRequest(c, { expectedVersion: body.expectedVersion, config: body.config as StudioConfig, reason: body.reason });
});

/** Rolls back by publishing an earlier version's config as a new version; history is never rewritten. */
studioControlRoutes.post("/studio-control/restore", async (c) => {
  const denied = denyUnless(c, "studio.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const body = z.object({ version: z.number().int().positive(), expectedVersion: z.number().int().positive(), reason: reasonSchema }).parse(await c.req.json());
  const [target] = await db.select().from(schema.studioConfigRevisions).where(eq(schema.studioConfigRevisions.version, body.version)).limit(1);
  if (!target) return c.json({ error: "No such version" }, 404);
  return publishOrRequest(c, { expectedVersion: body.expectedVersion, config: normalizeConfig(target.config), reason: body.reason, restoredFrom: target.version });
});

const windowSchema = z
  .object({
    scope: z.enum(["all", "renders", "selections"]),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    message: z.string().trim().max(280).nullable(),
    reason: reasonSchema,
  })
  .strict();

export type MaintenanceWindowPayload =
  | { op: "create"; window: z.infer<typeof windowSchema> }
  | { op: "cancel"; id: string; reason: string };

/** The window change itself, used directly and when an approved request is executed. */
export async function applyMaintenanceWindowChange(db: Database, payload: MaintenanceWindowPayload, actorId: string, approvalId: string | null) {
  if (payload.op === "create") {
    const { window } = payload;
    const id = crypto.randomUUID();
    const [[row]] = await db.batch([
      db.insert(schema.maintenanceWindows).values({ id, scope: window.scope, startsAt: new Date(window.startsAt), endsAt: new Date(window.endsAt), message: window.message || null, reason: window.reason, createdBy: actorId, approvalId }).returning(),
      adminEventInsert(db, { actorId, action: "maintenance.window", targetType: "maintenance_window", targetId: id, summary: `Scheduled ${window.scope} maintenance ${window.startsAt} – ${window.endsAt}`, detail: { ...window, ...(approvalId ? { approvalId } : {}) } }),
    ]);
    return row!;
  }
  const [[row]] = await db.batch([
    db.update(schema.maintenanceWindows).set({ cancelledAt: new Date(), cancelledBy: actorId }).where(and(eq(schema.maintenanceWindows.id, payload.id), sql`${schema.maintenanceWindows.cancelledAt} is null`)).returning(),
    adminEventInsert(db, { actorId, action: "maintenance.window", targetType: "maintenance_window", targetId: payload.id, summary: "Cancelled a maintenance window", detail: { reason: payload.reason, ...(approvalId ? { approvalId } : {}) } }),
  ]);
  return row ?? null;
}

/** Problems with a proposed window, judged against the clock now. */
export function windowProblem(window: z.infer<typeof windowSchema>, now = new Date()): string | null {
  const starts = new Date(window.startsAt);
  const ends = new Date(window.endsAt);
  if (ends <= starts) return "The window must end after it starts";
  if (ends <= now) return "The window has already ended";
  if (ends.getTime() - starts.getTime() > MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000) return `A window can last at most ${MAX_WINDOW_DAYS} days`;
  return null;
}

async function windowChange(c: Context<AdminContext>, payload: MaintenanceWindowPayload) {
  const db = c.get("db"); const actor = c.get("admin");
  const rules = await governance(db);
  if (rules.maintenanceApprovalThreshold > 0 && 1 >= rules.maintenanceApprovalThreshold) {
    const approval = await requestApproval(db, {
      action: "maintenance_window", actorId: actor.id, targetType: "maintenance_window", targetId: payload.op === "cancel" ? payload.id : undefined,
      riskValue: 1, threshold: rules.maintenanceApprovalThreshold, reason: payload.op === "create" ? payload.window.reason : payload.reason, payload,
    });
    return c.json({ pendingApproval: true, approvalId: approval.id }, 202);
  }
  const row = await applyMaintenanceWindowChange(db, payload, actor.id, null);
  if (!row) return c.json({ error: "That window is already cancelled" }, 409);
  return c.json({ window: toMaintenanceWindow(row, await emailsFor(db, [row.createdBy, row.cancelledBy])) }, payload.op === "create" ? 201 : 200);
}

studioControlRoutes.post("/maintenance-windows", async (c) => {
  const denied = denyUnless(c, "settings.manage"); if (denied) return c.json(denied, 403);
  const window = windowSchema.parse(await c.req.json());
  const problem = windowProblem(window);
  if (problem) return c.json({ error: problem, code: "invalid_window" }, 400);
  return windowChange(c, { op: "create", window });
});

studioControlRoutes.post("/maintenance-windows/:id/cancel", async (c) => {
  const denied = denyUnless(c, "settings.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const id = z.string().uuid().parse(c.req.param("id"));
  const { reason } = z.object({ reason: reasonSchema }).parse(await c.req.json());
  const [window] = await db.select().from(schema.maintenanceWindows).where(eq(schema.maintenanceWindows.id, id)).limit(1);
  if (!window) return c.json({ error: "Maintenance window not found" }, 404);
  if (window.cancelledAt) return c.json({ error: "That window is already cancelled" }, 409);
  if (window.endsAt <= new Date()) return c.json({ error: "That window has already ended" }, 409);
  return windowChange(c, { op: "cancel", id, reason });
});
