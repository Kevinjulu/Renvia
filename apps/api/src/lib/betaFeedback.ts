import sharp from "sharp";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Database } from "@renvia/db";
import type { BetaAnnotations } from "@renvia/types";

/**
 * Beta feedback (docs/beta-testing-system.md §6): annotations in image-normalized coordinates,
 * diagnostics copied from Renvia's own records when a report is filed (never supplied by the
 * browser), and compressed, capped screenshots in private storage.
 */

const unit = z.number().min(0).max(1).transform((value) => Math.round(value * 1000) / 1000);

export const annotationsSchema: z.ZodType<BetaAnnotations, z.ZodTypeDef, unknown> = z
  .object({
    v: z.literal(1),
    image: z.enum(["result", "source"]),
    pins: z.array(z.object({ x: unit, y: unit, label: z.string().trim().max(140).optional() }).strict()).max(10),
    boxes: z.array(z.object({ x: unit, y: unit, w: unit, h: unit }).strict()).max(5),
    strokes: z.array(z.object({ points: z.array(z.tuple([unit, unit])).min(2).max(64) }).strict()).max(5),
  })
  .strict();

/** Feedback screenshots: at most this many per tester in a program, each at most this size once compressed. */
export const MAX_ATTACHMENTS_PER_TESTER = 20;
export const MAX_ATTACHMENT_BYTES = 1_000_000;
/** What a tester may send before compression. */
export const MAX_SCREENSHOT_UPLOAD_BYTES = 5 * 1024 * 1024;

type RenderRow = typeof schema.renders.$inferSelect;

/**
 * What the team needs to reproduce a report about a render, from Renvia's own records: the job's
 * outcome, model, cost, credits, timings and lifecycle events. Prompts and settings stay on the
 * render (staff open it there); signed URLs, provider request ids and keys are never copied.
 */
export async function renderDiagnostics(db: Database, render: RenderRow, client: { appVersion?: string | null; requestId?: string | null; viewport?: string | null; userAgent?: string | null }) {
  const events = await db
    .select({ type: schema.renderJobEvents.eventType, stage: schema.renderJobEvents.stage, at: schema.renderJobEvents.occurredAt })
    .from(schema.renderJobEvents)
    .where(eq(schema.renderJobEvents.renderId, render.id))
    .orderBy(asc(schema.renderJobEvents.occurredAt))
    .limit(20);
  return {
    render: {
      status: render.status,
      jobType: render.jobType,
      model: render.model,
      outputResolution: render.outputResolution,
      configVersion: render.configVersion,
      creditsCharged: render.creditsCharged,
      costMicros: render.costMicros,
      betaFunded: Boolean(render.betaProgramId),
      errorMessage: render.errorMessage ? render.errorMessage.slice(0, 500) : null,
      createdAt: render.createdAt.toISOString(),
      updatedAt: render.updatedAt.toISOString(),
      durationMs: render.updatedAt.getTime() - render.createdAt.getTime(),
    },
    events: events.map((event) => ({ type: event.type, stage: event.stage, at: event.at.toISOString() })),
    client: clientDiagnostics(client),
  };
}

export function clientDiagnostics(client: { appVersion?: string | null; requestId?: string | null; viewport?: string | null; userAgent?: string | null }) {
  return {
    appVersion: client.appVersion?.slice(0, 64) ?? null,
    requestId: client.requestId?.slice(0, 128) ?? null,
    viewport: client.viewport?.slice(0, 32) ?? null,
    userAgent: client.userAgent?.slice(0, 200) ?? null,
  };
}

export class ScreenshotTooLargeError extends Error {
  constructor() {
    super("That screenshot can't be made small enough");
  }
}

/**
 * Re-encodes a screenshot as WebP no larger than 2048 px on its long edge and MAX_ATTACHMENT_BYTES,
 * stepping the quality down until it fits. Re-encoding also drops any metadata the file carried.
 */
export async function compressScreenshot(input: ArrayBuffer): Promise<Buffer> {
  const resized = sharp(Buffer.from(input), { limitInputPixels: 50_000_000 }).rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true });
  for (const quality of [80, 65, 50, 35]) {
    const output = await resized.clone().webp({ quality }).toBuffer();
    if (output.byteLength <= MAX_ATTACHMENT_BYTES) return output;
  }
  throw new ScreenshotTooLargeError();
}

export function feedbackAttachmentKey(programId: string, feedbackId: string): string {
  return `feedback/${programId}/${feedbackId}.webp`;
}

/** Bytes of screenshots already stored for a program, from the storage ledger. */
export async function programAttachmentBytes(db: Database, programId: string): Promise<number> {
  const [row] = await db
    .select({ bytes: sql<string>`coalesce(sum(${schema.storageObjects.bytes}), 0)::bigint` })
    .from(schema.storageObjects)
    .where(sql`${schema.storageObjects.key} like ${`feedback/${programId}/%`}`);
  return Number(row?.bytes ?? 0);
}

/** Screenshots this tester has attached in the program. */
export async function testerAttachmentCount(db: Database, enrollmentId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.betaFeedback)
    .where(and(eq(schema.betaFeedback.enrollmentId, enrollmentId), sql`${schema.betaFeedback.attachmentKey} is not null`));
  return Number(row?.n ?? 0);
}

/** "+1" is a comment with this marker, so the thread shows who confirmed an issue and when. */
export const PLUS_ONE = { plusOne: true } as const;

/**
 * +1s on a report, for a query that reads beta_feedback. The outer column is named with its table
 * on purpose: Drizzle leaves column references unqualified in single-table queries, and an
 * unqualified "id" inside this subquery would mean the comment's own id.
 */
export const plusOnesSql = sql<number>`(select count(*) from beta_feedback_comments pc where pc.feedback_id = beta_feedback.id and pc.detail ->> 'plusOne' = 'true')::int`;

/** Statuses after which a tester is waiting on nothing and the report is closed. */
export const CLOSED_STATUSES = ["resolved", "duplicate", "expected", "cannot_reproduce", "declined"] as const;
