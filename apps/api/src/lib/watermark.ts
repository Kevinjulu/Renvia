import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@renvia/db";
import type { Env } from "../index.js";
import { getBillingEntitlement } from "./billing.js";
import {
  getObject,
  isRenderOutputKey,
  isWatermarkedKey,
  objectExists,
  originalKeyFor,
  ownUploadKey,
  publicUploadUrl,
  putObject,
  renderIdForKey,
  storageWouldExceed,
  thumbnailKeyFor,
  type AssetViewer,
  type ServedImage,
  watermarkedKeyFor,
} from "./storage.js";
import { getSettings } from "./settings.js";
import { overlaySvg } from "./watermarkOverlay.js";
import { WATERMARK_VERSION } from "./watermarkVersions.js";

/**
 * Free-plan model output is watermarked everywhere it is shown or downloaded. The clean
 * original is kept and linked only to paid plans, so upgrading unlocks every earlier render.
 * Whether to watermark is decided from the plan the viewer has now, each time links are issued.
 */
export async function assetViewerFor(db: Database, userId: string): Promise<AssetViewer> {
  const [user] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, userId));
  if (user?.role === "admin") return { watermark: false };
  const billing = await getBillingEntitlement(db, userId);
  return { watermark: !billing || billing.plan.interval === "none" };
}

const viewersByRequest = new WeakMap<Request, Promise<AssetViewer>>();

/** The signed-in user's AssetViewer, looked up once per request however many links it issues. */
export function requestAssetViewer(request: Request, db: Database, clerkId: string): Promise<AssetViewer> {
  let viewer = viewersByRequest.get(request);
  if (!viewer) {
    viewer = db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.clerkId, clerkId))
      .then(([user]) => (user ? assetViewerFor(db, user.id) : { watermark: true }));
    viewersByRequest.set(request, viewer);
  }
  return viewer;
}

/** The image with the brand watermark (see watermarkOverlay.ts), in the same format it came in. */
export async function watermarkImage(bytes: Uint8Array, contentType: string): Promise<Uint8Array> {
  // Metadata describes the stored pixels; orientations 5-8 swap the axes once rotated upright.
  const { width = 0, height = 0, orientation = 1 } = await sharp(bytes).metadata();
  const [w, h] = orientation >= 5 ? [height, width] : [width, height];
  if (!w || !h) throw new Error("Couldn't read the image size");
  const composed = sharp(bytes).rotate().composite([{ input: Buffer.from(overlaySvg(w, h)), top: 0, left: 0 }]);
  const encoded = contentType === "image/png" ? composed.png() : contentType === "image/webp" ? composed.webp({ quality: 90 }) : composed.jpeg({ quality: 90 });
  return new Uint8Array(await encoded.toBuffer());
}

export { WATERMARK_VERSION };

/** Where the copy behind a watermarked/ link is stored; links stay the same across versions. */
const storedCopyKey = (key: string, version = WATERMARK_VERSION) => `watermarked-v${version}/${originalKeyFor(key)}`;

/**
 * Every stored watermarked copy of a model-output key, current and from earlier designs: the
 * unversioned copy the first design stored under the link's own key, then each versioned one.
 */
export function watermarkedCopyKeys(key: string): string[] {
  const versions = Array.from({ length: WATERMARK_VERSION - 1 }, (_, i) => storedCopyKey(key, i + 2));
  return [watermarkedKeyFor(originalKeyFor(key)), ...versions];
}

/**
 * Where the grid thumbnail of a served key is stored. A watermarked link's thumbnail is named
 * after the versioned copy it is made from, so a new design never reuses an old thumbnail; any
 * other key's thumbnail is named after the key itself.
 */
export function servedThumbnailKey(key: string): string {
  return thumbnailKeyFor(isWatermarkedKey(key) ? storedCopyKey(key) : key);
}

/**
 * The watermarked copy for a watermarked/ key, made from its original the first time it is
 * asked for and stored beside it. Null when the key isn't a watermarked render output or the
 * original doesn't exist.
 */
export async function watermarkedCopy(env: Env, key: string): Promise<ServedImage | null> {
  if (!isWatermarkedKey(key) || !isRenderOutputKey(originalKeyFor(key))) return null;
  if (await objectExists(env, storedCopyKey(key))) return { key: storedCopyKey(key) };
  const original = await getObject(env, originalKeyFor(key));
  if (!original) return null;
  const bytes = await watermarkImage(new Uint8Array(await new Response(original.body).arrayBuffer()), original.contentType);
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  // Deterministic key: two first requests racing both store the same bytes. Once storage is at
  // its cap the copy is made fresh for each request instead of stored.
  const db = createDb(env.DATABASE_URL);
  if (!(await storageWouldExceed(db, (await getSettings(db)).storageCapMb, body.byteLength))) {
    await putObject(env, storedCopyKey(key), body, original.contentType);
    return { key: storedCopyKey(key) };
  }
  return { body: new Blob([body], { type: original.contentType }).stream(), contentType: original.contentType };
}

export class ForeignRenderError extends Error {
  constructor() {
    super("That image belongs to another account");
  }
}

/**
 * An image a user sends as a render, edit, reference or selection input. Model output is
 * accepted only from the user's own renders, and a watermarked link is swapped for its clean
 * original, so a free-plan user's edits and "set as base" never bake the watermark in.
 * Uploads and external links pass through unchanged.
 */
export async function resolveImageInput(db: Database, userId: string, url: string, origin: string): Promise<string> {
  const stored = ownUploadKey(url, origin);
  if (!stored) return url;
  const key = originalKeyFor(stored);
  if (!isRenderOutputKey(key)) return isWatermarkedKey(stored) ? publicUploadUrl(origin, key) : url;
  const renderId = renderIdForKey(key);
  const [owned] = renderId
    ? await db
        .select({ id: schema.renders.id })
        .from(schema.renders)
        .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
        .where(and(eq(schema.renders.id, renderId), eq(schema.projects.ownerId, userId)))
    : [];
  if (!owned) throw new ForeignRenderError();
  return publicUploadUrl(origin, key);
}
