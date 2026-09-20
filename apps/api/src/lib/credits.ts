import { eq, sql } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";

type RenderRow = typeof schema.renders.$inferSelect;
type RenderInsert = typeof schema.renders.$inferInsert;

/** Postgres error for the users_credit_balance_non_negative check constraint. */
const CHECK_VIOLATION = "23514";

export class InsufficientCreditsError extends Error {
  constructor() {
    super("Not enough credits");
  }
}

function isCheckViolation(error: unknown): boolean {
  for (let current: unknown = error; current; current = (current as { cause?: unknown }).cause) {
    if ((current as { code?: string }).code === CHECK_VIOLATION) return true;
  }
  return false;
}

/**
 * Creates a render and charges for it in one transaction: the balance decrement, the
 * render row and its ledger entry commit together or not at all. The non-negative
 * balance constraint makes an unaffordable render roll the whole batch back, which
 * holds even when several renders are submitted at once.
 */
export async function createChargedRender(
  db: Database,
  userId: string,
  credits: number,
  values: Omit<RenderInsert, "id" | "creditsCharged">,
): Promise<RenderRow> {
  const id = crypto.randomUUID();
  if (credits === 0) {
    const [created] = await db.insert(schema.renders).values({ ...values, id }).returning();
    return created!;
  }

  try {
    const [, [created]] = await db.batch([
      db
        .update(schema.users)
        .set({ creditBalance: sql`${schema.users.creditBalance} - ${credits}` })
        .where(eq(schema.users.id, userId)),
      db.insert(schema.renders).values({ ...values, id, creditsCharged: credits }).returning(),
      db.insert(schema.creditLedger).values({ userId, amount: -credits, reason: "render", renderId: id }),
    ]);
    return created!;
  } catch (error) {
    if (isCheckViolation(error)) throw new InsufficientCreditsError();
    throw error;
  }
}

type SegmentationRow = typeof schema.segmentations.$inferSelect;
type SegmentationInsert = typeof schema.segmentations.$inferInsert;

/**
 * Creates a segmentation and charges for it in one transaction — same pattern as renders.
 */
export async function createChargedSegmentation(
  db: Database,
  userId: string,
  credits: number,
  values: Omit<SegmentationInsert, "id" | "creditsCharged" | "userId">,
): Promise<SegmentationRow> {
  const id = crypto.randomUUID();
  if (credits === 0) {
    const [created] = await db.insert(schema.segmentations).values({ ...values, id, userId }).returning();
    return created!;
  }

  try {
    const [, [created]] = await db.batch([
      db
        .update(schema.users)
        .set({ creditBalance: sql`${schema.users.creditBalance} - ${credits}` })
        .where(eq(schema.users.id, userId)),
      db.insert(schema.segmentations).values({ ...values, id, userId, creditsCharged: credits }).returning(),
      db.insert(schema.creditLedger).values({ userId, amount: -credits, reason: "segment", segmentationId: id }),
    ]);
    return created!;
  } catch (error) {
    if (isCheckViolation(error)) throw new InsufficientCreditsError();
    throw error;
  }
}

/**
 * Returns a failed/empty segmentation's credits. Unique (segmentation_id, reason) keeps it idempotent.
 */
export async function refundSegmentationIfNeeded(
  db: Database,
  segmentation: SegmentationRow,
): Promise<SegmentationRow> {
  if (segmentation.creditsCharged <= 0) return segmentation;
  if (segmentation.status !== "failed" && !(segmentation.status === "succeeded" && (segmentation.objectCount ?? 0) === 0)) {
    return segmentation;
  }

  const [refund] = await db
    .insert(schema.creditLedger)
    .values({
      userId: segmentation.userId,
      amount: segmentation.creditsCharged,
      reason: "segment_refund",
      segmentationId: segmentation.id,
    })
    .onConflictDoNothing()
    .returning({ id: schema.creditLedger.id });
  if (refund) {
    await db
      .update(schema.users)
      .set({ creditBalance: sql`${schema.users.creditBalance} + ${segmentation.creditsCharged}` })
      .where(eq(schema.users.id, segmentation.userId));
  }
  return segmentation;
}

/**
 * Returns a failed render's credits. The ledger's unique (render_id, reason) index makes
 * this idempotent: racing refreshes and the fal webhook can all call it, but only the
 * first inserts the refund row and restores the balance.
 */
export async function refundIfFailed(db: Database, render: RenderRow): Promise<RenderRow> {
  if (render.status !== "failed" || render.creditsCharged <= 0) return render;

  const [project] = await db
    .select({ ownerId: schema.projects.ownerId })
    .from(schema.projects)
    .where(eq(schema.projects.id, render.projectId));
  if (!project) return render;

  const [refund] = await db
    .insert(schema.creditLedger)
    .values({ userId: project.ownerId, amount: render.creditsCharged, reason: "render_refund", renderId: render.id })
    .onConflictDoNothing()
    .returning({ id: schema.creditLedger.id });
  if (refund) {
    await db
      .update(schema.users)
      .set({ creditBalance: sql`${schema.users.creditBalance} + ${render.creditsCharged}` })
      .where(eq(schema.users.id, project.ownerId));
  }
  return render;
}
