import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "@renvia/db";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { getOrCreateUser } from "../lib/users.js";
import { createChargedSegmentation, InsufficientCreditsError } from "../lib/credits.js";
import { wouldExceedBudget } from "../lib/engine.js";
import { effectiveEngineMode, getSettings } from "../lib/settings.js";
import { checkAllowance, refuseBudget, refuseCredits, refuseDisabled, refuseInput, resolveLimits } from "../lib/limits.js";
import { ownUploadKey } from "../lib/storage.js";
import { runSegmentation, SAM_COST_MICROS, SAM_MODEL_ID } from "../lib/segment.js";

export const segmentations = new Hono<AppContext>();

segmentations.use("*", requireAuth);

const createSchema = z
  .object({
    imageUrl: z.string().url(),
    // Hard ceiling; app_settings.max_selection_prompt_chars is the tunable cap.
    prompt: z.string().trim().min(1).max(1000).optional(),
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
  const appSettings = await getSettings(db);
  if (user.disabled) {
    const refusal = refuseDisabled(appSettings);
    return c.json(refusal, refusal.status);
  }

  const origin = new URL(c.req.url).origin;
  if (!ownUploadKey(body.imageUrl, origin)) {
    return c.json({ error: "Selection needs an uploaded image", code: "invalid_image" }, 400);
  }

  const isAdmin = user.role === "admin";
  const limits = resolveLimits(user, appSettings);

  if (body.prompt && body.prompt.length > limits.maxSelectionPromptChars) {
    const refusal = refuseInput(appSettings, "prompt_too_long", limits.maxSelectionPromptChars, body.prompt.length);
    return c.json(refusal, refusal.status);
  }

  const allowance = await checkAllowance(db, user, appSettings, "segment");
  if (allowance) return c.json(allowance, allowance.status);

  const mode = effectiveEngineMode(c.env, appSettings);
  const costMicros = mode === "mock" ? 0 : SAM_COST_MICROS;
  if (await wouldExceedBudget(c.env, db, costMicros)) {
    const refusal = refuseBudget(appSettings);
    return c.json(refusal, refusal.status);
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
      const refusal = refuseCredits(appSettings, user.creditBalance, credits);
      return c.json(refusal, refusal.status);
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
