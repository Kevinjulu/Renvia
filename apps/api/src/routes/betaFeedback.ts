import { Hono, type Context } from "hono";
import { and, asc, desc, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { createDb, schema, type Database } from "@renvia/db";
import type { BetaFeedbackCategory, BetaFeedbackComment, BetaFeedbackDetail, BetaFeedbackSummary, BetaKnownIssue } from "@renvia/types";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { getOrCreateUser } from "../lib/users.js";
import { settleBetaCredits } from "../lib/beta.js";
import { getSettings } from "../lib/settings.js";
import { refuseStorage } from "../lib/limits.js";
import { putObject, signedUploadUrl, storageWouldExceed } from "../lib/storage.js";
import { presentForViewer } from "../lib/presentAsset.js";
import {
  annotationsSchema,
  CLOSED_STATUSES,
  clientDiagnostics,
  compressScreenshot,
  feedbackAttachmentKey,
  MAX_ATTACHMENTS_PER_TESTER,
  MAX_SCREENSHOT_UPLOAD_BYTES,
  PLUS_ONE,
  plusOnesSql,
  programAttachmentBytes,
  renderDiagnostics,
  ScreenshotTooLargeError,
  testerAttachmentCount,
} from "../lib/betaFeedback.js";

/**
 * A tester's reports (docs/beta-testing-system.md §6): file one (optionally about a render, with
 * marks on the image and a screenshot), follow its thread, answer the team, confirm a fix, and
 * see the program's known issues. A tester only ever sees their own reports.
 */
export const betaFeedback = new Hono<AppContext>();

// Scoped to its own paths: this app shares /beta with the invitation preview, which is public.
betaFeedback.use("/feedback", requireAuth);
betaFeedback.use("/feedback/*", requireAuth);
betaFeedback.use("/known-issues", requireAuth);

type FeedbackRow = typeof schema.betaFeedback.$inferSelect;
const MB = 1_000_000;

const CATEGORIES = ["architecture_changed", "materials_wrong", "render_failed", "render_stuck", "edit_wrong", "ui_problem", "billing_credits", "other"] as const;

async function tester(c: Context<AppContext>) {
  const db = createDb(c.env.DATABASE_URL);
  const user = await getOrCreateUser(c.env, db, c.get("auth").clerkId);
  const { context } = await settleBetaCredits(db, user.id, { betaCredits: user.betaCredits });
  return { db, user, context };
}

/**
 * The team is waiting on the tester: a fix to confirm, or a question asked after their last word.
 * Outer columns carry their table name: Drizzle leaves them unqualified in single-table queries,
 * where "id" inside the subqueries would otherwise mean the comment's own id.
 */
const awaitingSql = sql<boolean>`(beta_feedback.status = 'ready_to_verify' or (beta_feedback.status not in ('resolved', 'duplicate', 'expected', 'cannot_reproduce', 'declined') and exists (
    select 1 from beta_feedback_comments rq where rq.feedback_id = beta_feedback.id and rq.kind = 'request_info'
      and rq.created_at > coalesce((select max(tc.created_at) from beta_feedback_comments tc where tc.feedback_id = beta_feedback.id and tc.author_id = beta_feedback.user_id), '-infinity'::timestamptz))))`;

function summary(row: FeedbackRow, awaitingTester: boolean): BetaFeedbackSummary {
  return {
    id: row.id,
    number: row.number,
    kind: row.kind,
    category: row.category,
    title: row.title,
    status: row.status,
    renderId: row.renderId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    awaitingTester,
  };
}

async function ownReport(db: Database, userId: string, id: string) {
  const [row] = await db
    .select({ feedback: schema.betaFeedback, awaiting: awaitingSql })
    .from(schema.betaFeedback)
    .where(and(eq(schema.betaFeedback.id, id), eq(schema.betaFeedback.userId, userId)));
  return row ?? null;
}

async function presentDetail(c: Context<AppContext>, db: Database, row: FeedbackRow, awaiting: boolean): Promise<BetaFeedbackDetail> {
  const origin = new URL(c.req.url).origin;
  const [comments, [render]] = await Promise.all([
    db
      .select()
      .from(schema.betaFeedbackComments)
      .where(and(eq(schema.betaFeedbackComments.feedbackId, row.id), eq(schema.betaFeedbackComments.visibility, "tester")))
      .orderBy(asc(schema.betaFeedbackComments.createdAt)),
    row.renderId ? db.select({ source: schema.renders.sourceImageUrl, result: schema.renders.resultImageUrl }).from(schema.renders).where(eq(schema.renders.id, row.renderId)) : Promise.resolve([]),
  ]);
  const thread: BetaFeedbackComment[] = comments
    .filter((comment) => !(comment.detail as { plusOne?: boolean } | null)?.plusOne)
    .map((comment) => ({
      id: comment.id,
      kind: comment.kind,
      body: comment.body,
      fromTeam: comment.authorId !== row.userId,
      status: (comment.detail as { status?: BetaFeedbackDetail["status"] } | null)?.status ?? null,
      createdAt: comment.createdAt.toISOString(),
    }));
  return {
    ...summary(row, awaiting),
    description: row.description,
    severity: row.severityReported,
    annotations: row.annotations ?? null,
    // Exactly as the Studio shows them to this person (watermarked on a free plan).
    resultImageUrl: render ? await presentForViewer(c, origin, render.result) : null,
    sourceImageUrl: render ? await presentForViewer(c, origin, render.source) : null,
    attachmentUrl: row.attachmentKey ? await signedUploadUrl(c.env, origin, row.attachmentKey) : null,
    comments: thread,
  };
}

const createSchema = z
  .object({
    kind: z.enum(["bug", "visual_quality", "usability", "suggestion", "praise"]),
    category: z.enum(CATEGORIES),
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(4000).default(""),
    severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
    renderId: z.string().uuid().nullable().optional(),
    projectId: z.string().uuid().nullable().optional(),
    canvasNodeId: z.string().trim().max(100).nullable().optional(),
    annotations: annotationsSchema.nullable().optional(),
    appVersion: z.string().trim().max(64).nullable().optional(),
    requestId: z.string().trim().max(128).nullable().optional(),
    viewport: z.string().trim().max(32).nullable().optional(),
  })
  .strict();

betaFeedback.post("/feedback", async (c) => {
  const body = createSchema.parse(await c.req.json());
  const { db, user, context } = await tester(c);
  if (!context) return c.json({ error: "You're not in a beta program", code: "not_enrolled" }, 403);

  let render: typeof schema.renders.$inferSelect | null = null;
  let projectId = body.projectId ?? null;
  if (body.renderId) {
    const [owned] = await db
      .select({ render: schema.renders })
      .from(schema.renders)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.renders.projectId))
      .where(and(eq(schema.renders.id, body.renderId), eq(schema.projects.ownerId, user.id)));
    if (!owned) return c.json({ error: "That render isn't yours", code: "render_not_found" }, 404);
    render = owned.render;
    projectId = render.projectId;
  } else if (projectId) {
    const [project] = await db.select({ id: schema.projects.id }).from(schema.projects).where(and(eq(schema.projects.id, projectId), eq(schema.projects.ownerId, user.id)));
    if (!project) return c.json({ error: "That project isn't yours", code: "project_not_found" }, 404);
  }
  if (body.annotations && !render) return c.json({ error: "Marks need a render to sit on", code: "annotations_without_render" }, 400);

  const client = { ...body, userAgent: c.req.header("User-Agent") ?? null };
  const diagnostics = render ? await renderDiagnostics(db, render, client) : { client: clientDiagnostics(client) };
  const [created] = await db
    .insert(schema.betaFeedback)
    .values({
      programId: context.program.id,
      enrollmentId: context.enrollment.id,
      userId: user.id,
      kind: body.kind,
      category: body.category,
      title: body.title,
      description: body.description,
      severityReported: body.severity,
      renderId: render?.id ?? null,
      projectId,
      canvasNodeId: body.canvasNodeId ?? null,
      annotations: body.annotations ?? null,
      diagnostics,
    })
    .returning();
  return c.json(await presentDetail(c, db, created!, false), 201);
});

betaFeedback.get("/feedback", async (c) => {
  const { db, user } = await tester(c);
  const rows = await db
    .select({ feedback: schema.betaFeedback, awaiting: awaitingSql })
    .from(schema.betaFeedback)
    .where(eq(schema.betaFeedback.userId, user.id))
    .orderBy(desc(schema.betaFeedback.updatedAt))
    .limit(100);
  return c.json({ feedback: rows.map((row) => summary(row.feedback, Boolean(row.awaiting))) });
});

betaFeedback.get("/feedback/:id", async (c) => {
  const id = z.string().uuid().parse(c.req.param("id"));
  const { db, user } = await tester(c);
  const row = await ownReport(db, user.id, id);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(await presentDetail(c, db, row.feedback, Boolean(row.awaiting)));
});

betaFeedback.post("/feedback/:id/comments", async (c) => {
  const id = z.string().uuid().parse(c.req.param("id"));
  const { body } = z.object({ body: z.string().trim().min(1).max(4000) }).parse(await c.req.json());
  const { db, user } = await tester(c);
  const row = await ownReport(db, user.id, id);
  if (!row) return c.json({ error: "Not found" }, 404);
  await db.batch([
    db.insert(schema.betaFeedbackComments).values({ feedbackId: id, authorId: user.id, body, visibility: "tester" }),
    db.update(schema.betaFeedback).set({ updatedAt: new Date() }).where(eq(schema.betaFeedback.id, id)),
  ]);
  const updated = (await ownReport(db, user.id, id))!;
  return c.json(await presentDetail(c, db, updated.feedback, Boolean(updated.awaiting)));
});

const SCREENSHOT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * One screenshot per report, re-encoded to a small WebP and kept privately under feedback/. Text
 * feedback always works; a screenshot is refused (and the report kept) when it would pass the
 * tester's, the program's or the whole bucket's storage allowance.
 */
betaFeedback.post("/feedback/:id/attachment", async (c) => {
  const id = z.string().uuid().parse(c.req.param("id"));
  const contentType = c.req.header("Content-Type") ?? "";
  if (!SCREENSHOT_TYPES.has(contentType)) return c.json({ error: "Attach a PNG, JPEG or WebP image", code: "unsupported_type" }, 400);
  const declared = Number(c.req.header("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_SCREENSHOT_UPLOAD_BYTES) return c.json({ error: "That screenshot is over 5 MB", code: "upload_too_large" }, 413);

  const { db, user } = await tester(c);
  const row = await ownReport(db, user.id, id);
  if (!row) return c.json({ error: "Not found" }, 404);
  const report = row.feedback;
  if (report.attachmentKey) return c.json({ error: "This report already has a screenshot", code: "already_attached" }, 409);
  if ((await testerAttachmentCount(db, report.enrollmentId)) >= MAX_ATTACHMENTS_PER_TESTER) {
    return c.json({ error: `You've attached ${MAX_ATTACHMENTS_PER_TESTER} screenshots, the most for this program. Your report is saved without one.`, code: "attachment_limit" }, 409);
  }

  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength > MAX_SCREENSHOT_UPLOAD_BYTES) return c.json({ error: "That screenshot is over 5 MB", code: "upload_too_large" }, 413);
  let webp: Buffer;
  try {
    webp = await compressScreenshot(bytes);
  } catch (error) {
    if (error instanceof ScreenshotTooLargeError) return c.json({ error: error.message, code: "upload_too_large" }, 413);
    return c.json({ error: "That file isn't an image we can read", code: "unreadable_image" }, 400);
  }

  const [program] = await db.select({ budgetMb: schema.betaPrograms.attachmentBudgetMb }).from(schema.betaPrograms).where(eq(schema.betaPrograms.id, report.programId));
  if ((await programAttachmentBytes(db, report.programId)) + webp.byteLength > (program?.budgetMb ?? 0) * MB) {
    return c.json({ error: "Screenshot storage for this program is full. Your report is saved; describe what you saw instead.", code: "attachment_budget" }, 409);
  }
  const settings = await getSettings(db);
  if (await storageWouldExceed(db, settings.storageCapMb, webp.byteLength)) {
    const refusal = refuseStorage(settings);
    return c.json(refusal, refusal.status);
  }

  const key = feedbackAttachmentKey(report.programId, report.id);
  await putObject(c.env, key, webp.buffer.slice(webp.byteOffset, webp.byteOffset + webp.byteLength) as ArrayBuffer, "image/webp");
  const [updated] = await db
    .update(schema.betaFeedback)
    .set({ attachmentKey: key, updatedAt: new Date() })
    .where(and(eq(schema.betaFeedback.id, id), isNull(schema.betaFeedback.attachmentKey)))
    .returning();
  if (!updated) return c.json({ error: "This report already has a screenshot", code: "already_attached" }, 409);
  return c.json(await presentDetail(c, db, updated, Boolean(row.awaiting)));
});

/** The tester answers "Fixed — can you check?": confirmed closes it, not fixed sends it back. */
betaFeedback.post("/feedback/:id/confirm-fix", async (c) => {
  const id = z.string().uuid().parse(c.req.param("id"));
  const { fixed, comment } = z.object({ fixed: z.boolean(), comment: z.string().trim().max(4000).optional() }).parse(await c.req.json());
  const { db, user } = await tester(c);
  const row = await ownReport(db, user.id, id);
  if (!row) return c.json({ error: "Not found" }, 404);
  if (row.feedback.status !== "ready_to_verify") return c.json({ error: "There's no fix waiting for you to check", code: "nothing_to_confirm" }, 409);
  const status = fixed ? "resolved" : "triaged";
  const now = new Date();
  await db.batch([
    db
      .update(schema.betaFeedback)
      .set({ status, resolvedAt: fixed ? now : null, updatedAt: now })
      .where(and(eq(schema.betaFeedback.id, id), eq(schema.betaFeedback.status, "ready_to_verify"))),
    db.insert(schema.betaFeedbackComments).values({
      feedbackId: id,
      authorId: user.id,
      body: comment ?? (fixed ? "Confirmed fixed." : "Still happening."),
      visibility: "tester",
      kind: "status_change",
      detail: { status, from: "ready_to_verify", by: "tester" },
    }),
  ]);
  const updated = (await ownReport(db, user.id, id))!;
  return c.json(await presentDetail(c, db, updated.feedback, Boolean(updated.awaiting)));
});

/** The program's open known issues, optionally for one category, so testers confirm instead of re-reporting. */
betaFeedback.get("/known-issues", async (c) => {
  const category = z.enum(CATEGORIES).optional().parse(c.req.query("category") || undefined) as BetaFeedbackCategory | undefined;
  const { db, user, context } = await tester(c);
  if (!context) return c.json({ issues: [] });
  const rows = await db
    .select({
      feedback: schema.betaFeedback,
      plusOnes: plusOnesSql,
      mine: sql<boolean>`(beta_feedback.user_id = ${user.id} or exists (select 1 from beta_feedback_comments m where m.feedback_id = beta_feedback.id and m.author_id = ${user.id} and m.detail ->> 'plusOne' = 'true'))`,
    })
    .from(schema.betaFeedback)
    .where(and(
      eq(schema.betaFeedback.programId, context.program.id),
      eq(schema.betaFeedback.knownIssue, true),
      notInArray(schema.betaFeedback.status, [...CLOSED_STATUSES]),
      category ? eq(schema.betaFeedback.category, category) : undefined,
    ))
    .orderBy(desc(schema.betaFeedback.updatedAt))
    .limit(50);
  const issues: BetaKnownIssue[] = rows.map(({ feedback, plusOnes, mine }) => ({
    id: feedback.id,
    number: feedback.number,
    title: feedback.knownIssueTitle || feedback.title,
    category: feedback.category,
    status: feedback.status,
    plusOnes: Number(plusOnes),
    mine: Boolean(mine),
  }));
  return c.json({ issues });
});

/** "I have this too" on a known issue: recorded once per tester, on the original report. */
betaFeedback.post("/feedback/:id/plus-one", async (c) => {
  const id = z.string().uuid().parse(c.req.param("id"));
  const { db, user, context } = await tester(c);
  if (!context) return c.json({ error: "You're not in a beta program", code: "not_enrolled" }, 403);
  const [issue] = await db
    .select({ id: schema.betaFeedback.id })
    .from(schema.betaFeedback)
    .where(and(eq(schema.betaFeedback.id, id), eq(schema.betaFeedback.programId, context.program.id), eq(schema.betaFeedback.knownIssue, true), ne(schema.betaFeedback.userId, user.id)));
  if (!issue) return c.json({ error: "Not found" }, 404);
  const [already] = await db
    .select({ id: schema.betaFeedbackComments.id })
    .from(schema.betaFeedbackComments)
    .where(and(eq(schema.betaFeedbackComments.feedbackId, id), eq(schema.betaFeedbackComments.authorId, user.id), sql`${schema.betaFeedbackComments.detail} ->> 'plusOne' = 'true'`));
  if (!already) {
    await db.insert(schema.betaFeedbackComments).values({ feedbackId: id, authorId: user.id, body: "", visibility: "internal", detail: { ...PLUS_ONE } });
  }
  return c.json({ ok: true, alreadyCounted: Boolean(already) });
});

/** Replies on this tester's reports since they last read them (their own messages and +1s aside). */
export async function unreadRepliesFor(db: Database, userId: string, since: Date | null): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.betaFeedbackComments)
    .innerJoin(schema.betaFeedback, eq(schema.betaFeedback.id, schema.betaFeedbackComments.feedbackId))
    .where(and(
      eq(schema.betaFeedback.userId, userId),
      eq(schema.betaFeedbackComments.visibility, "tester"),
      inArray(schema.betaFeedbackComments.kind, ["comment", "status_change", "request_info"]),
      sql`${schema.betaFeedbackComments.authorId} is distinct from ${userId}`,
      since ? sql`${schema.betaFeedbackComments.createdAt} > ${since.toISOString()}::timestamptz` : undefined,
    ));
  return Number(row?.n ?? 0);
}
