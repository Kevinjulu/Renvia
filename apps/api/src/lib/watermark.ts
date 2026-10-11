import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";
import type { Env } from "../index.js";
import { getBillingEntitlement } from "./billing.js";
import {
  getObject,
  isRenderOutputKey,
  isWatermarkedKey,
  originalKeyFor,
  ownUploadKey,
  publicUploadUrl,
  putObject,
  renderIdForKey,
  type AssetViewer,
} from "./storage.js";

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

// The RENVIA wordmark as strokes on a 104 x 20 grid, so it renders without any fonts installed.
const WORDMARK_WIDTH = 104;
const WORDMARK_HEIGHT = 20;
const WORDMARK_PATH = [
  "M0 20V0H8A6 5 0 0 1 8 10H0M7 10L14 20", // R
  "M34 0H20V20H34M20 10H31", // E
  "M40 20V0L54 20V0", // N
  "M60 0L67 20L74 0", // V
  "M82 0V20", // I
  "M90 20L97 0L104 20M93 13H101", // A
].join("");

/** The overlay for a w x h image: a sparse diagonal pattern plus a corner badge. */
function overlaySvg(width: number, height: number): string {
  // The mark scales with the image so it reads the same on a thumbnail and on an 8K export.
  const markWidth = Math.max(60, Math.round(width / 7));
  const scale = markWidth / WORDMARK_WIDTH;
  const markHeight = WORDMARK_HEIGHT * scale;
  const tileWidth = markWidth * 2.4;
  const tileHeight = markHeight * 7;
  const stroke = 2.6;
  const badgeScale = scale * 0.8;
  const badgeWidth = WORDMARK_WIDTH * badgeScale + 28;
  const badgeHeight = WORDMARK_HEIGHT * badgeScale + 20;
  const margin = Math.round(Math.min(width, height) * 0.03);
  const mark = (opacity: number, colour: string, extra = 0) =>
    `<path d="${WORDMARK_PATH}" fill="none" stroke="${colour}" stroke-opacity="${opacity}" stroke-width="${stroke + extra}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <pattern id="tile" patternUnits="userSpaceOnUse" width="${tileWidth}" height="${tileHeight}" patternTransform="rotate(-24)">
      <g transform="translate(${tileWidth * 0.1} ${tileHeight * 0.4}) scale(${scale})">${mark(0.1, "#000", 2)}${mark(0.22, "#fff")}</g>
      <g transform="translate(${tileWidth * 0.6} ${tileHeight * 0.9}) scale(${scale})">${mark(0.1, "#000", 2)}${mark(0.22, "#fff")}</g>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#tile)"/>
  <g transform="translate(${width - margin - badgeWidth} ${height - margin - badgeHeight})">
    <rect width="${badgeWidth}" height="${badgeHeight}" rx="${badgeHeight / 2}" fill="#111" fill-opacity="0.45"/>
    <g transform="translate(14 10) scale(${badgeScale})">${mark(0.92, "#fff")}</g>
  </g>
</svg>`;
}

/** The image with the RENVIA watermark, in the same format it came in. */
export async function watermarkImage(bytes: Uint8Array, contentType: string): Promise<Uint8Array> {
  // Metadata describes the stored pixels; orientations 5-8 swap the axes once rotated upright.
  const { width = 0, height = 0, orientation = 1 } = await sharp(bytes).metadata();
  const [w, h] = orientation >= 5 ? [height, width] : [width, height];
  if (!w || !h) throw new Error("Couldn't read the image size");
  const composed = sharp(bytes).rotate().composite([{ input: Buffer.from(overlaySvg(w, h)), top: 0, left: 0 }]);
  const encoded = contentType === "image/png" ? composed.png() : contentType === "image/webp" ? composed.webp({ quality: 90 }) : composed.jpeg({ quality: 90 });
  return new Uint8Array(await encoded.toBuffer());
}

/**
 * The watermarked copy for a watermarked/ key, made from its original the first time it is
 * asked for and stored beside it. Null when the key isn't a watermarked render output or the
 * original doesn't exist.
 */
export async function watermarkedObject(env: Env, key: string): Promise<{ body: ReadableStream; contentType: string } | null> {
  if (!isWatermarkedKey(key) || !isRenderOutputKey(originalKeyFor(key))) return null;
  const existing = await getObject(env, key);
  if (existing) return existing;
  const original = await getObject(env, originalKeyFor(key));
  if (!original) return null;
  const bytes = await watermarkImage(new Uint8Array(await new Response(original.body).arrayBuffer()), original.contentType);
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  // Deterministic key: two first requests racing both store the same bytes.
  await putObject(env, key, body, original.contentType);
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
