import { Hono, type Context } from "hono";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { schema, type Database } from "@renvia/db";
import type { AdminBetaFeedbackComment, AdminBetaFeedbackDetail, AdminBetaFeedbackListResponse, AdminBetaFeedbackSummary, BetaFeedbackStatus } from "@renvia/types";
import { presentUploadUrl, signedUploadUrl } from "../../lib/storage.js";
import { CLOSED_STATUSES, plusOnesSql } from "../../lib/betaFeedback.js";
import { denyUnless } from "./permissions.js";
import { adminEventInsert } from "./shared.js";
import type { AdminContext } from "./context.js";

/**
 * The beta Feedback Inbox (docs/beta-testing-system.md §6.6): triage, replies and internal notes,
 * requests for more information, duplicates, known issues and resolution. Status changes are
 * written to the report's thread; the ones a tester should know about are visible to them.
 */
export const betaFeedbackRoutes = new Hono<AdminContext>();

const STATUSES = ["new", "triaged", "investigating", "fix_in_progress", "ready_to_verify", "resolved", "duplicate", "expected", "cannot_reproduce", "declined"] as const;
const CATEGORIES = ["architecture_changed", "materials_wrong", "render_failed", "render_stuck", "edit_wrong", "ui_problem", "billing_credits", "other"] as const;

/** Statuses a tester hears about; the rest are the team's own bookkeeping. */
const TESTER_VISIBLE_STATUSES: readonly BetaFeedbackStatus[] = ["investigating", "fix_in_progress", "ready_to_verify", "resolved", "duplicate", "expected", "cannot_reproduce", "declined"];

const STATUS_MESSAGE: Partial<Record<BetaFeedbackStatus, string>> = {
  investigating: "We're looking into this.",
  fix_in_progress: "We're working on a fix.",
  ready_to_verify: "We think this is fixed — can you check and let us know?",
  resolved: "This is resolved. Thank you for reporting it.",
  duplicate: "This is the same problem as another report; we're tracking it there.",
  expected: "This is how Ramah Studio is meant to work at the moment.",
  cannot_reproduce: "We couldn't make this happen ourselves. Tell us if you see it again.",
  declined: "We've decided not to change this for now.",
};

const assignee = alias(schema.users, "assignee");

function summaryQuery(db: Database) {
  return db
    .select({
      feedback: schema.betaFeedback,
      testerEmail: schema.users.email,
      assigneeEmail: assignee.email,
      plusOnes: plusOnesSql,
    })
    .from(schema.betaFeedback)
    .innerJoin(schema.users, eq(schema.users.id, schema.betaFeedback.userId))
    .leftJoin(assignee, eq(assignee.id, schema.betaFeedback.assigneeId));
}

type SummaryRow = Awaited<ReturnType<ReturnType<typeof summaryQuery>["execute"]>>[number];

function toSummary({ feedback, testerEmail, assigneeEmail, plusOnes }: SummaryRow): AdminBetaFeedbackSummary {
  return {
    id: feedback.id,
    number: feedback.number,
    programId: feedback.programId,
    testerEmail,
    kind: feedback.kind,
    category: feedback.category,
    title: feedback.title,
    status: feedback.status,
    severity: feedback.severity,
    severityReported: feedback.severityReported,
    knownIssue: feedback.knownIssue,
    assigneeId: feedback.assigneeId,
    assigneeEmail: assigneeEmail ?? null,
    renderId: feedback.renderId,
    hasAttachment: Boolean(feedback.attachmentKey),
    plusOnes: Number(plusOnes),
    createdAt: feedback.createdAt.toISOString(),
    updatedAt: feedback.updatedAt.toISOString(),
  };
}

betaFeedbackRoutes.get("/beta/feedback", async (c) => {
  const denied = denyUnless(c, "beta.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const query = z
    .object({
      programId: z.string().uuid().optional(),
      status: z.enum(STATUSES).optional(),
      category: z.enum(CATEGORIES).optional(),
      severity: z.enum(["low", "medium", "high", "critical"]).optional(),
      knownIssue: z.enum(["true", "false"]).optional(),
      assigneeId: z.string().uuid().optional(),
      page: z.coerce.number().int().min(1).max(1000).default(1),
    })
    .parse(c.req.query());
  const scope = query.programId ? eq(schema.betaFeedback.programId, query.programId) : undefined;
  const filters = and(
    scope,
    query.status ? eq(schema.betaFeedback.status, query.status) : undefined,
    query.category ? eq(schema.betaFeedback.category, query.category) : undefined,
    // Triage severity when set, otherwise what the tester reported.
    query.severity ? sql`coalesce(${schema.betaFeedback.severity}, ${schema.betaFeedback.severityReported}) = ${query.severity}` : undefined,
    query.knownIssue ? eq(schema.betaFeedback.knownIssue, query.knownIssue === "true") : undefined,
    query.assigneeId ? eq(schema.betaFeedback.assigneeId, query.assigneeId) : undefined,
  );
  const pageSize = 50;
  const [rows, counts] = await Promise.all([
    summaryQuery(db).where(filters).orderBy(desc(schema.betaFeedback.updatedAt)).limit(pageSize).offset((query.page - 1) * pageSize),
    db.select({ status: schema.betaFeedback.status, n: sql<number>`count(*)::int` }).from(schema.betaFeedback).where(scope).groupBy(schema.betaFeedback.status),
  ]);
  const response: AdminBetaFeedbackListResponse = {
    feedback: rows.map(toSummary),
    counts: Object.fromEntries(counts.map((row) => [row.status, Number(row.n)])),
  };
  return c.json(response);
});

async function presentDetail(c: Context<AdminContext>, db: Database, id: string): Promise<AdminBetaFeedbackDetail | null> {
  const [row] = await summaryQuery(db).where(eq(schema.betaFeedback.id, id));
  if (!row) return null;
  const { feedback } = row;
  const origin = new URL(c.req.url).origin;
  const [comments, [render], [original], [duplicates]] = await Promise.all([
    db
      .select({ comment: schema.betaFeedbackComments, authorEmail: schema.users.email })
      .from(schema.betaFeedbackComments)
      .leftJoin(schema.users, eq(schema.users.id, schema.betaFeedbackComments.authorId))
      .where(eq(schema.betaFeedbackComments.feedbackId, id))
      .orderBy(asc(schema.betaFeedbackComments.createdAt)),
    feedback.renderId ? db.select().from(schema.renders).where(eq(schema.renders.id, feedback.renderId)) : Promise.resolve([]),
    feedback.duplicateOf ? db.select({ id: schema.betaFeedback.id, number: schema.betaFeedback.number }).from(schema.betaFeedback).where(eq(schema.betaFeedback.id, feedback.duplicateOf)) : Promise.resolve([]),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.betaFeedback).where(eq(schema.betaFeedback.duplicateOf, id)),
  ]);
  const thread: AdminBetaFeedbackComment[] = comments.map(({ comment, authorEmail }) => ({
    id: comment.id,
    authorEmail: authorEmail ?? null,
    fromTeam: comment.authorId !== feedback.userId,
    visibility: comment.visibility,
    kind: comment.kind,
    body: comment.body,
    detail: comment.detail ?? null,
    createdAt: comment.createdAt.toISOString(),
  }));
  return {
    ...toSummary(row),
    description: feedback.description,
    annotations: feedback.annotations ?? null,
    diagnostics: feedback.diagnostics ?? null,
    projectId: feedback.projectId,
    canvasNodeId: feedback.canvasNodeId,
    // Staff see the clean images: the same render the tester marked, at full quality.
    render: render
      ? {
          status: render.status,
          jobType: render.jobType,
          model: render.model,
          sourceImageUrl: await presentUploadUrl(c.env, origin, render.sourceImageUrl),
          resultImageUrl: await presentUploadUrl(c.env, origin, render.resultImageUrl),
        }
      : null,
    attachmentUrl: feedback.attachmentKey ? await signedUploadUrl(c.env, origin, feedback.attachmentKey) : null,
    knownIssueTitle: feedback.knownIssueTitle,
    githubUrl: feedback.githubUrl,
    duplicateOf: original ?? null,
    duplicates: Number(duplicates?.n ?? 0),
    resolvedAt: feedback.resolvedAt?.toISOString() ?? null,
    comments: thread,
  };
}

betaFeedbackRoutes.get("/beta/feedback/:id", async (c) => {
  const denied = denyUnless(c, "beta.read"); if (denied) return c.json(denied, 403);
  const detail = await presentDetail(c, c.get("db"), z.string().uuid().parse(c.req.param("id")));
  return detail ? c.json(detail) : c.json({ error: "Not found" }, 404);
});

/** A status change and the thread entry that records it, written together. */
function statusWrites(db: Database, feedbackId: string, actorId: string, from: BetaFeedbackStatus, to: BetaFeedbackStatus, extra: Record<string, unknown> = {}) {
  const now = new Date();
  return [
    db
      .update(schema.betaFeedback)
      // Any closed outcome dates the close; screenshots are deleted 90 days after it.
      .set({ status: to, resolvedAt: (CLOSED_STATUSES as readonly string[]).includes(to) ? now : null, updatedAt: now, ...extra })
      .where(eq(schema.betaFeedback.id, feedbackId)),
    db.insert(schema.betaFeedbackComments).values({
      feedbackId,
      authorId: actorId,
      body: STATUS_MESSAGE[to] ?? "",
      visibility: TESTER_VISIBLE_STATUSES.includes(to) ? "tester" : "internal",
      kind: "status_change",
      detail: { status: to, from },
    }),
  ] as const;
}

const updateSchema = z
  .object({
    status: z.enum(STATUSES).optional(),
    severity: z.enum(["low", "medium", "high", "critical"]).nullable().optional(),
    assigneeId: z.string().uuid().nullable().optional(),
    knownIssue: z.boolean().optional(),
    knownIssueTitle: z.string().trim().max(120).nullable().optional(),
    githubUrl: z.string().trim().url().max(300).nullable().optional(),
  })
  .strict();

betaFeedbackRoutes.patch("/beta/feedback/:id", async (c) => {
  const denied = denyUnless(c, "beta.feedback.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const actor = c.get("admin");
  const id = z.string().uuid().parse(c.req.param("id"));
  const patch = updateSchema.parse(await c.req.json());
  const [current] = await db.select().from(schema.betaFeedback).where(eq(schema.betaFeedback.id, id));
  if (!current) return c.json({ error: "Not found" }, 404);
  if (patch.status === "duplicate") return c.json({ error: "Mark duplicates with the duplicate action, which links the original", code: "use_duplicate" }, 400);
  if (patch.assigneeId) {
    const [staff] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, patch.assigneeId));
    if (!staff || staff.role === "user") return c.json({ error: "Assign reports to a member of staff", code: "invalid_assignee" }, 400);
  }
  const { status, ...fields } = patch;
  const changesStatus = status !== undefined && status !== current.status;
  await db.batch([
    db.update(schema.betaFeedback).set({ ...fields, updatedAt: new Date() }).where(eq(schema.betaFeedback.id, id)),
    ...(changesStatus ? statusWrites(db, id, actor.id, current.status, status) : []),
    adminEventInsert(db, {
      actorId: actor.id, action: "beta.update", targetType: "beta_feedback", targetId: id,
      summary: `Updated BETA-${current.number}${changesStatus ? `: ${current.status} → ${status}` : ""}`,
      detail: { before: { status: current.status, severity: current.severity, assigneeId: current.assigneeId, knownIssue: current.knownIssue }, after: patch },
    }),
  ]);
  return c.json(await presentDetail(c, db, id));
});

/** A reply the tester sees, or an internal note only staff see. */
betaFeedbackRoutes.post("/beta/feedback/:id/comments", async (c) => {
  const denied = denyUnless(c, "beta.feedback.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const id = z.string().uuid().parse(c.req.param("id"));
  const { body, visibility } = z.object({ body: z.string().trim().min(1).max(4000), visibility: z.enum(["tester", "internal"]) }).parse(await c.req.json());
  const [current] = await db.select({ id: schema.betaFeedback.id }).from(schema.betaFeedback).where(eq(schema.betaFeedback.id, id));
  if (!current) return c.json({ error: "Not found" }, 404);
  await db.batch([
    db.insert(schema.betaFeedbackComments).values({ feedbackId: id, authorId: c.get("admin").id, body, visibility }),
    db.update(schema.betaFeedback).set({ updatedAt: new Date() }).where(eq(schema.betaFeedback.id, id)),
  ]);
  return c.json(await presentDetail(c, db, id), 201);
});

/** Asks the tester something; the report moves to investigating and shows as waiting on them. */
betaFeedbackRoutes.post("/beta/feedback/:id/request-info", async (c) => {
  const denied = denyUnless(c, "beta.feedback.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const actor = c.get("admin");
  const id = z.string().uuid().parse(c.req.param("id"));
  const { body } = z.object({ body: z.string().trim().min(1).max(4000) }).parse(await c.req.json());
  const [current] = await db.select().from(schema.betaFeedback).where(eq(schema.betaFeedback.id, id));
  if (!current) return c.json({ error: "Not found" }, 404);
  await db.batch([
    db.update(schema.betaFeedback).set({ status: "investigating", resolvedAt: null, updatedAt: new Date() }).where(eq(schema.betaFeedback.id, id)),
    db.insert(schema.betaFeedbackComments).values({ feedbackId: id, authorId: actor.id, body, visibility: "tester", kind: "request_info", detail: { status: "investigating", from: current.status } }),
    adminEventInsert(db, { actorId: actor.id, action: "beta.update", targetType: "beta_feedback", targetId: id, summary: `Asked the tester about BETA-${current.number}`, detail: { from: current.status } }),
  ]);
  return c.json(await presentDetail(c, db, id), 201);
});

/**
 * Marks a report as a duplicate of another in the same program. The tester is told, and the
 * original gains their report as a +1 so its count reflects everyone affected.
 */
betaFeedbackRoutes.post("/beta/feedback/:id/duplicate", async (c) => {
  const denied = denyUnless(c, "beta.feedback.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const actor = c.get("admin");
  const id = z.string().uuid().parse(c.req.param("id"));
  const { of } = z.object({ of: z.string().uuid() }).parse(await c.req.json());
  if (of === id) return c.json({ error: "A report can't duplicate itself", code: "invalid_duplicate" }, 400);
  const reports = await db.select().from(schema.betaFeedback).where(inArray(schema.betaFeedback.id, [id, of]));
  const current = reports.find((report) => report.id === id);
  const original = reports.find((report) => report.id === of);
  if (!current || !original) return c.json({ error: "Not found" }, 404);
  if (original.programId !== current.programId) return c.json({ error: "Both reports must be in the same program", code: "invalid_duplicate" }, 400);
  if (original.duplicateOf) return c.json({ error: `BETA-${original.number} is itself a duplicate; link to the report it duplicates`, code: "invalid_duplicate" }, 400);
  const [alreadyCounted] = await db
    .select({ id: schema.betaFeedbackComments.id })
    .from(schema.betaFeedbackComments)
    .where(and(eq(schema.betaFeedbackComments.feedbackId, of), eq(schema.betaFeedbackComments.authorId, current.userId), sql`${schema.betaFeedbackComments.detail} ->> 'plusOne' = 'true'`));
  await db.batch([
    ...statusWrites(db, id, actor.id, current.status, "duplicate", { duplicateOf: of }),
    ...(alreadyCounted || original.userId === current.userId
      ? []
      : [db.insert(schema.betaFeedbackComments).values({ feedbackId: of, authorId: current.userId, body: "", visibility: "internal", detail: { plusOne: true, fromReport: id } })]),
    adminEventInsert(db, { actorId: actor.id, action: "beta.update", targetType: "beta_feedback", targetId: id, summary: `Merged BETA-${current.number} into BETA-${original.number}`, detail: { of } }),
  ]);
  return c.json(await presentDetail(c, db, id));
});
