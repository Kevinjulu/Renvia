import { createFalClient } from "@fal-ai/client";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";
import type { RenderEngineMode } from "@renvia/types";
import type { Env } from "../index.js";
import { refundSegmentationIfNeeded } from "./credits.js";
import { getObject, ownUploadKey } from "./storage.js";

type SegmentationRow = typeof schema.segmentations.$inferSelect;

export const SAM_MODEL_ID = "fal-ai/sam-3/image";
/** fal SAM 3 is $0.005/request. */
export const SAM_COST_MICROS = 5_000;

interface SegmentResult {
  maskDataUrl: string;
  objectCount: number;
}

async function readOwnUpload(
  env: Env,
  url: string,
  origin: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const key = ownUploadKey(url, origin);
  if (!key) return null;
  const object = await getObject(env, key);
  if (!object) throw new Error("Image not found");
  return { bytes: new Uint8Array(await new Response(object.body).arrayBuffer()), contentType: object.contentType };
}

async function falReachableImageUrl(env: Env, url: string, origin: string): Promise<string> {
  const fal = createFalClient({ credentials: env.FAL_KEY });
  const upload = await readOwnUpload(env, url, origin);
  if (!upload) return url;
  return fal.storage.upload(new Blob([new Uint8Array(upload.bytes)], { type: upload.contentType }));
}

/** White circle near the centre — enough for mock edit flow without calling fal. */
async function mockMaskDataUrl(imageUrl: string, origin: string, env: Env, point?: { x: number; y: number }): Promise<SegmentResult> {
  const upload = await readOwnUpload(env, imageUrl, origin);
  let width = 1024;
  let height = 1024;
  if (upload) {
    const meta = await sharp(upload.bytes).metadata();
    width = meta.width ?? width;
    height = meta.height ?? height;
  }
  const cx = point ? Math.round(point.x) : Math.round(width / 2);
  const cy = point ? Math.round(point.y) : Math.round(height / 2);
  const radius = Math.max(24, Math.round(Math.min(width, height) * 0.12));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="black"/>
    <circle cx="${cx}" cy="${cy}" r="${radius}" fill="white"/>
  </svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return { maskDataUrl: `data:image/png;base64,${png.toString("base64")}`, objectCount: 1 };
}

async function urlToPngBytes(url: string): Promise<Uint8Array> {
  if (url.startsWith("data:")) {
    const base64 = url.split(",")[1];
    if (!base64) throw new Error("Invalid mask data URL");
    return Uint8Array.from(Buffer.from(base64, "base64"));
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't download mask (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

/** OR-combine white masks into one white-on-black PNG data URL. */
async function combineMasks(maskUrls: string[]): Promise<string> {
  if (maskUrls.length === 0) throw new Error("No masks returned");
  const layers = await Promise.all(maskUrls.map((url) => urlToPngBytes(url)));
  const meta = await sharp(layers[0]!).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error("Mask has no dimensions");

  let combined = await sharp(layers[0]!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 1; i < layers.length; i++) {
    const next = await sharp(layers[i]!).resize(width, height, { fit: "fill" }).ensureAlpha().raw().toBuffer();
    for (let p = 0; p < combined.data.length; p += 4) {
      const bright = Math.max(combined.data[p]!, next[p]!);
      combined.data[p] = bright;
      combined.data[p + 1] = bright;
      combined.data[p + 2] = bright;
      combined.data[p + 3] = 255;
    }
  }
  const png = await sharp(combined.data, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

async function runSam(
  env: Env,
  imageUrl: string,
  origin: string,
  prompt?: string | null,
  point?: { x: number; y: number } | null,
): Promise<SegmentResult> {
  const fal = createFalClient({ credentials: env.FAL_KEY });
  const reachable = await falReachableImageUrl(env, imageUrl, origin);
  const input = {
    image_url: reachable,
    apply_mask: false,
    sync_mode: true,
    output_format: "png" as const,
    return_multiple_masks: true,
    max_masks: 8,
    ...(prompt?.trim() ? { prompt: prompt.trim() } : {}),
    ...(point ? { point_prompts: [{ x: Math.round(point.x), y: Math.round(point.y), label: "1" as const }] } : {}),
  };

  const result = await fal.subscribe(SAM_MODEL_ID, { input, logs: false });
  const data = result.data as {
    masks?: { url?: string }[];
    image?: { url?: string };
  };
  const urls = (data.masks ?? []).map((mask) => mask.url).filter((url): url is string => Boolean(url));
  if (urls.length === 0 && data.image?.url) urls.push(data.image.url);
  if (urls.length === 0) return { maskDataUrl: "", objectCount: 0 };
  return { maskDataUrl: await combineMasks(urls), objectCount: urls.length };
}

/**
 * Runs SAM (or mock), updates the row, refunds on failure / empty match.
 * Returns the finished row plus the mask for the studio.
 */
export async function runSegmentation(
  env: Env,
  db: Database,
  segmentation: SegmentationRow,
  origin: string,
  mode: RenderEngineMode,
): Promise<{ segmentation: SegmentationRow; maskDataUrl: string }> {
  try {
    const result =
      mode === "mock"
        ? await mockMaskDataUrl(segmentation.imageUrl, origin, env, segmentation.point ?? undefined)
        : await runSam(env, segmentation.imageUrl, origin, segmentation.prompt, segmentation.point);

    if (result.objectCount === 0 || !result.maskDataUrl) {
      const [failed] = await db
        .update(schema.segmentations)
        .set({
          status: "succeeded",
          objectCount: 0,
          costMicros: 0,
          errorMessage: "Nothing matched that selection",
        })
        .where(eq(schema.segmentations.id, segmentation.id))
        .returning();
      const refunded = await refundSegmentationIfNeeded(db, failed!);
      return { segmentation: refunded, maskDataUrl: "" };
    }

    const costMicros = mode === "mock" ? 0 : SAM_COST_MICROS;
    const [updated] = await db
      .update(schema.segmentations)
      .set({
        status: "succeeded",
        objectCount: result.objectCount,
        costMicros,
        errorMessage: null,
      })
      .where(eq(schema.segmentations.id, segmentation.id))
      .returning();
    return { segmentation: updated!, maskDataUrl: result.maskDataUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Segmentation failed";
    console.error("segmentation failed", error);
    const [failed] = await db
      .update(schema.segmentations)
      .set({ status: "failed", costMicros: 0, errorMessage: message, objectCount: 0 })
      .where(eq(schema.segmentations.id, segmentation.id))
      .returning();
    const refunded = await refundSegmentationIfNeeded(db, failed!);
    return { segmentation: refunded, maskDataUrl: "" };
  }
}
