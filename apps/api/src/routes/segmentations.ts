import { Hono } from "hono";
import { and, eq, gte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { createDb, schema } from "@renvia/db";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { getOrCreateUser } from "../lib/users.js";
import { createChargedSegmentation, InsufficientCreditsError } from "../lib/credits.js";
import { wouldExceedBudget } from "../lib/engine.js";
import { effectiveEngineMode, getSettings } from "../lib/settings.js";
import { ownUploadKey } from "../lib/storage.js";
import { runSegmentation, SAM_COST_MICROS, SAM_MODEL_ID } from "../lib/segment.js";

export const segmentations = new Hono<AppContext>();

segmentations.use("*", requireAuth);

const createSchema = z
  .object({
    imageUrl: z.string().url(),
    prompt: z.string().trim().min(1).max(200).optional(),
    point: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
      })
      .optional(),
  })
  .refine((body) => Boolean(body.prompt) || Boolean(body.point), {
    message: "Provide a text prompt and/or a click point",
  });

segmentations.post("/", async (c) => {
  const { clerkId } = c.get("auth");
  const body = createSchema.parse(await c.req.json());
  const db = createDb(c.env.DATABASE_URL);

  const user = await getOrCreateUser(c.env, db, clerkId);
  if (user.disabled) {
    return c.json({ error: "Account disabled", code: "account_disabled" }, 403);
  }

  const origin = new URL(c.req.url).origin;
  if (!ownUploadKey(body.imageUrl, origin)) {
    return c.json({ error: "Selection needs an uploaded image", code: "invalid_image" }, 400);
  }

  const appSettings = await getSettings(db);
  const isAdmin = user.role === "admin";

  if (!isAdmin && appSettings.maintenanceSegments) {
    return c.json(
      {
        error: appSettings.maintenanceMessage?.trim() || "Selections are temporarily paused for maintenance",
        code: "maintenance",
      },
      503,
    );
  }

  if (!isAdmin && appSettings.dailySegmentLimit !== null) {
    const [today] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.segmentations)
      .where(
        and(
          eq(schema.segmentations.userId, user.id),
          ne(schema.segmentations.status, "failed"),
          gte(schema.segmentations.createdAt, sql`date_trunc('day', now() at time zone 'utc') at time zone 'utc'`),
        ),
      );
    if ((today?.count ?? 0) >= appSettings.dailySegmentLimit) {
      return c.json({ error: "Daily selection limit reached", code: "daily_limit_reached" }, 429);
    }
  }

  const mode = effectiveEngineMode(c.env, appSettings);
  const costMicros = mode === "mock" ? 0 : SAM_COST_MICROS;
  if (await wouldExceedBudget(c.env, db, costMicros)) {
    return c.json({ error: "Render budget exhausted", code: "budget_exhausted" }, 402);
  }

  const credits = isAdmin ? 0 : appSettings.creditsPerSelection;
  let created;
  try {
    created = await createChargedSegmentation(db, user.id, credits, {
      imageUrl: body.imageUrl,
      prompt: body.prompt ?? null,
      point: body.point ?? null,
      status: "pending",
      model: mode === "mock" ? "mock" : SAM_MODEL_ID,
      costMicros,
    });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return c.json({ error: "Not enough credits", code: "insufficient_credits" }, 402);
    }
    throw error;
  }

  const { segmentation, maskDataUrl } = await runSegmentation(c.env, db, created, origin, mode);

  if (segmentation.status === "failed") {
    return c.json(
      {
        error: segmentation.errorMessage ?? "Segmentation failed",
        code: "segmentation_failed",
        objectCount: 0,
        creditsCharged: 0,
      },
      502,
    );
  }

  if (segmentation.objectCount === 0 || !maskDataUrl) {
    return c.json({
      maskDataUrl: "",
      objectCount: 0,
      creditsCharged: 0,
    });
  }

  return c.json({
    maskDataUrl,
    objectCount: segmentation.objectCount ?? 0,
    creditsCharged: segmentation.creditsCharged,
  });
});
