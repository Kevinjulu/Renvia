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
  type AssetViewer,
  type ServedImage,
  watermarkedKeyFor,
} from "./storage.js";
import { getSettings } from "./settings.js";

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

// The mark is drawn as paths, so it renders without any fonts installed. Units are pixels on a
// 1536px-wide image; the overlay scales them to the image's long side.
const BASE_SIDE = 1536;

// The faceted R monogram on a 42 x 49 grid: top bar and bowl running into the leg, plus a
// separate stem with slanted cuts.
const MONOGRAM_PATH = [
  "M0 0H26A12.75 12.75 0 0 1 26 25.5H22.5L41.7 49H30.5L6.5 19H26A6 6 0 0 0 26 7H6.7Z", // bar, bowl, leg
  "M0 22L6.7 27.3V46.5L0 42Z", // stem
].join("");

// The RENVIA wordmark as strokes on a 127 x 20 grid, a light geometric sans with wide tracking.
const WORDMARK_PATH = [
  "M1 19V1H8.5A5.25 5.25 0 0 1 8.5 11.5H1M8.5 11.5L14.8 19", // R
  "M37.3 1H24.3V19H37.3M24.3 10H36", // E
  "M48.5 19V1L62.3 19V1", // N
  "M72.6 1L80.8 19L89 1", // V
  "M99.2 1V19", // I
  "M108.4 19L117.1 1L125.8 19M111.5 12.6H122.7", // A
].join("");

// The monogram and wordmark side by side; the wordmark sits centred on the monogram.
const MARK = `<path d="${MONOGRAM_PATH}" fill="#fff"/><path d="${WORDMARK_PATH}" transform="translate(64.7 16.5)" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>`;

// Marks repeat on a straight grid, offset so the first sits just inside the top-left corner.
const COLUMN_STEP = 326;
const ROW_STEP = 179;
const FIRST_MARK = { x: 65, y: 56 };

// A dashed X sits in each gap between four marks, its arms reaching toward their corners.
const CROSS_ARM = { x: 70, y: 61 };
// Where each cross sits relative to the mark below and to the right of it.
const CROSS_OFFSET = { x: -71, y: -63 };
const CROSS = `<path d="M${-CROSS_ARM.x} ${-CROSS_ARM.y}L${CROSS_ARM.x} ${CROSS_ARM.y}M${CROSS_ARM.x} ${-CROSS_ARM.y}L${-CROSS_ARM.x} ${CROSS_ARM.y}" stroke="#fff" stroke-width="1" stroke-dasharray="14 5"/>`;

/** The overlay for a w x h image: a grid of RENVIA marks laced with dashed crosses. */
function overlaySvg(width: number, height: number): string {
  // The mark scales with the image so it reads the same on a thumbnail and on an 8K export.
  const scale = Math.max(width, height) / BASE_SIDE;
  const cols = Math.ceil(width / scale / COLUMN_STEP) + 1;
  const rows = Math.ceil(height / scale / ROW_STEP) + 1;
  const marks: string[] = [];
  const crosses: string[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = FIRST_MARK.x + col * COLUMN_STEP;
      const y = FIRST_MARK.y + row * ROW_STEP;
      marks.push(`<use xlink:href="#mark" x="${x}" y="${y}"/>`);
      // Each cross sits up and to the left of its mark, so the top row and left column get one too.
      crosses.push(`<use xlink:href="#cross" x="${x + CROSS_OFFSET.x}" y="${y + CROSS_OFFSET.y}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}">
  <defs>
    <g id="mark">${MARK}</g>
    <g id="cross">${CROSS}</g>
  </defs>
  <g transform="scale(${scale})">
    <g opacity="0.5">${crosses.join("")}</g>
    <g opacity="0.45">${marks.join("")}</g>
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

// Bump when the overlay changes, so copies made with an earlier design are remade on next open.
const WATERMARK_VERSION = 2;

/** Where the copy behind a watermarked/ link is stored; links stay the same across versions. */
const storedCopyKey = (key: string) => `watermarked-v${WATERMARK_VERSION}/${originalKeyFor(key)}`;

/** Every stored watermarked copy of a model-output key, current and from earlier designs. */
export function watermarkedCopyKeys(key: string): string[] {
  return [watermarkedKeyFor(key), storedCopyKey(key)];
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
