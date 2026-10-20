import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { eq, sql } from "drizzle-orm";
import { createDb, schema, type Database } from "@renvia/db";
import type { Env } from "../index.js";

/** Storage settings, preferring STORAGE_* and falling back to the older NEON_STORAGE_* names. */
export function storageConfig(env: Env) {
  const pick = (value: string | undefined, fallback: string | undefined) => value?.trim() || fallback?.trim() || "";
  return {
    accessKeyId: pick(env.STORAGE_ACCESS_KEY_ID, env.NEON_STORAGE_ACCESS_KEY_ID),
    secretAccessKey: pick(env.STORAGE_SECRET_ACCESS_KEY, env.NEON_STORAGE_SECRET_ACCESS_KEY),
    endpoint: pick(env.STORAGE_ENDPOINT, env.NEON_STORAGE_ENDPOINT),
    bucket: pick(env.STORAGE_BUCKET, env.NEON_STORAGE_BUCKET),
    region: pick(env.STORAGE_REGION, env.NEON_STORAGE_REGION) || "auto",
  };
}

export function storageConfigured(env: Env): boolean {
  const config = storageConfig(env);
  return Boolean(config.accessKeyId && config.secretAccessKey && config.endpoint && config.bucket);
}

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function extensionForContentType(contentType: string): string | null {
  return EXTENSION_BY_CONTENT_TYPE[contentType] ?? null;
}

function requireExtension(contentType: string): string {
  const extension = extensionForContentType(contentType);
  if (!extension) {
    throw new Error(`Unsupported content type: ${contentType}`);
  }
  return extension;
}

export function objectKeyFor(clerkId: string, contentType: string): string {
  return `elevations/${clerkId}/${crypto.randomUUID()}.${requireExtension(contentType)}`;
}

/** Deterministic per render, so a result stored twice by racing refreshes overwrites itself. */
export function renderResultKeyFor(renderId: string, contentType: string): string {
  return `renders/${renderId}.${requireExtension(contentType)}`;
}

/** The 4K or 8K copy a render made with an output resolution keeps beside its standard result. */
export function renderHighResKeyFor(renderId: string, target: "4k" | "8k", contentType: string): string {
  return `renders/${renderId}-${target}.${requireExtension(contentType)}`;
}

/** The first pass of a two-pass edit, kept apart from the final result it feeds. */
export function renderIntermediateKeyFor(renderId: string, contentType: string): string {
  return `renders/${renderId}-selection.${requireExtension(contentType)}`;
}

/**
 * Model output: renders, edit passes and high-resolution exports. Free-plan viewers only ever
 * get links to its watermarked copy, stored beside it under WATERMARKED_PREFIX.
 */
const RENDER_PREFIX = "renders/";
const WATERMARKED_PREFIX = "watermarked/";

export function isRenderOutputKey(key: string): boolean {
  return key.startsWith(RENDER_PREFIX);
}

export function watermarkedKeyFor(key: string): string {
  return `${WATERMARKED_PREFIX}${key}`;
}

export function isWatermarkedKey(key: string): boolean {
  return key.startsWith(WATERMARKED_PREFIX);
}

/** The clean object behind a watermarked copy's key; any other key is returned unchanged. */
export function originalKeyFor(key: string): string {
  return isWatermarkedKey(key) ? key.slice(WATERMARKED_PREFIX.length) : key;
}

/** The render a model-output key belongs to (renders/<id>.png, renders/<id>-selection.png). */
export function renderIdForKey(key: string): string | null {
  const match = /^renders\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(originalKeyFor(key));
  return match?.[1] ?? null;
}

// The whole app is mounted under "/api" for Vercel's api/ directory convention
// (see apps/api/api/[...route].ts), so served objects live under this prefix.
const UPLOADS_PATH = "/api/uploads/";
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;
/**
 * Clean render originals get a much shorter link. A signed link can't be revoked, so after a
 * downgrade an already-issued clean link keeps working until it expires: at most this long,
 * plus the rounding in linkExpiry (one twelfth of it).
 */
const ORIGINAL_RENDER_TTL_SECONDS = 60 * 60 * 12;

/**
 * Keep media reachable if an older deployment has not yet been given the
 * dedicated signing secret. The storage credential is server-only and has the
 * same entropy requirements, while a dedicated key can still be configured to
 * decouple future media-link rotations from storage credential rotation.
 */
function storageSigningSecret(env: Env): string {
  return env.STORAGE_URL_SIGNING_SECRET?.trim() || storageConfig(env).secretAccessKey;
}

export function publicUploadUrl(origin: string, key: string): string {
  return `${origin}${UPLOADS_PATH}${key}`;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Web Crypto in TypeScript 5.9 requires a concrete ArrayBuffer-backed view. */
function cryptoBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

async function signatureFor(secret: string, key: string, expires: number): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const signingKey = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", signingKey, encoder.encode(`${key}:${expires}`)));
}

/**
 * When a link signed now expires: at least `ttl` from now, rounded up to a twelfth of the TTL.
 * Every response in that window gets the same link for the same object, so the browser can
 * keep the image it already downloaded instead of fetching it again under a new signature.
 */
export function linkExpiry(ttl: number, now = Math.floor(Date.now() / 1000)): number {
  const window = Math.floor(ttl / 12);
  return Math.ceil((now + ttl) / window) * window;
}

/** A browser-safe link that expires, so the storage bucket is not an anonymous public CDN. */
export async function signedUploadUrl(env: Env, origin: string, key: string): Promise<string> {
  const ttl = isRenderOutputKey(key) ? ORIGINAL_RENDER_TTL_SECONDS : SIGNED_URL_TTL_SECONDS;
  const expires = linkExpiry(ttl);
  const signature = base64Url(await signatureFor(storageSigningSecret(env), key, expires));
  const url = new URL(publicUploadUrl(origin, key));
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signature);
  return url.toString();
}

/** Who a link is for. Free-plan viewers get watermarked model output; staff tools omit it. */
export interface AssetViewer {
  watermark: boolean;
}

/**
 * Re-sign one of our persisted URLs for `viewer`; external links are returned unchanged.
 * Model output is linked clean, or as its watermarked copy when the viewer needs one,
 * whichever form the stored URL was in. Without a viewer (staff tools) it is always clean.
 */
export function presentUploadUrl(env: Env, origin: string, url: string, viewer?: AssetViewer): Promise<string>;
export function presentUploadUrl(env: Env, origin: string, url: null, viewer?: AssetViewer): Promise<null>;
export function presentUploadUrl(env: Env, origin: string, url: string | null, viewer?: AssetViewer): Promise<string | null>;
export async function presentUploadUrl(env: Env, origin: string, url: string | null, viewer?: AssetViewer): Promise<string | null> {
  if (!url) return null;
  const stored = ownUploadKey(url, origin);
  if (!stored) return url;
  const key = originalKeyFor(stored);
  return signedUploadUrl(env, origin, viewer?.watermark && isRenderOutputKey(key) ? watermarkedKeyFor(key) : key);
}

export async function hasValidSignature(env: Env, key: string, url: URL): Promise<boolean> {
  const expires = Number(url.searchParams.get("expires"));
  const supplied = url.searchParams.get("signature");
  if (!Number.isSafeInteger(expires) || expires < Math.floor(Date.now() / 1000) || !supplied) return false;
  const signature = fromBase64Url(supplied);
  if (!signature) return false;
  const signingKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(storageSigningSecret(env)), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", signingKey, cryptoBytes(signature), new TextEncoder().encode(`${key}:${expires}`));
}

/** The storage key if `url` points at one of our own served uploads, else null. */
export function ownUploadKey(url: string, origin: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== origin || !parsed.pathname.startsWith(UPLOADS_PATH)) return null;
  return decodeURIComponent(parsed.pathname.slice(UPLOADS_PATH.length)) || null;
}

function createStorageClient(env: Env): S3Client {
  const config = storageConfig(env);
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
}

const THUMBNAIL_PREFIX = "thumbs/";

/** Where the small grid/card copy of `key` is stored; made the first time it is asked for. */
export function thumbnailKeyFor(key: string): string {
  return `${THUMBNAIL_PREFIX}${key}.webp`;
}

/**
 * feedback: beta testers' report screenshots, kept under feedback/ and counted separately.
 * stock: the sample references the team uploads for everyone, under stock/.
 * thumbnail: small copies of any of the above, under thumbs/.
 */
export type StorageKind = "upload" | "render" | "watermark" | "feedback" | "stock" | "thumbnail";

/** Where watermark.ts stores the copy behind a watermarked/ link: watermarked-v<version>/. */
const STORED_WATERMARK_COPY = /^watermarked-v\d+\//;

export function storageKindFor(key: string): StorageKind {
  if (key.startsWith(THUMBNAIL_PREFIX)) return "thumbnail";
  if (key.startsWith("feedback/")) return "feedback";
  if (key.startsWith("stock/")) return "stock";
  if (isWatermarkedKey(key) || STORED_WATERMARK_COPY.test(key)) return "watermark";
  return isRenderOutputKey(key) ? "render" : "upload";
}

/**
 * Writes an object and records its size in storage_objects, which is how usage is counted
 * against the storage cap. A failed record is logged, not thrown: the object is already stored.
 */
export async function putObject(env: Env, key: string, bytes: ArrayBuffer, contentType: string): Promise<void> {
  const client = createStorageClient(env);
  await client.send(
    new PutObjectCommand({
      Bucket: storageConfig(env).bucket,
      Key: key,
      Body: new Uint8Array(bytes),
      ContentType: contentType,
    }),
  );
  try {
    await createDb(env.DATABASE_URL)
      .insert(schema.storageObjects)
      .values({ key, bytes: bytes.byteLength, contentType, kind: storageKindFor(key) })
      .onConflictDoUpdate({ target: schema.storageObjects.key, set: { bytes: bytes.byteLength, contentType, createdAt: new Date() } });
  } catch (error) {
    console.error("storage object not recorded", key, error);
  }
}

/** Bytes stored, in total and by kind, from the storage_objects ledger. */
export async function storageUsage(db: Database): Promise<{ usedBytes: number; byKind: Record<StorageKind, number>; objects: number }> {
  const rows = await db
    .select({ kind: schema.storageObjects.kind, bytes: sql<string>`coalesce(sum(${schema.storageObjects.bytes}), 0)::bigint`, objects: sql<number>`count(*)::int` })
    .from(schema.storageObjects)
    .groupBy(schema.storageObjects.kind);
  const byKind: Record<StorageKind, number> = { upload: 0, render: 0, watermark: 0, feedback: 0, stock: 0, thumbnail: 0 };
  for (const row of rows) byKind[row.kind] = Number(row.bytes);
  return { usedBytes: Object.values(byKind).reduce((sum, value) => sum + value, 0), byKind, objects: rows.reduce((sum, row) => sum + row.objects, 0) };
}

/** Megabytes as Cloudflare counts them (10^6 bytes). */
export const BYTES_PER_MB = 1_000_000;

/** True when `bytes` more would take stored objects past the operator's cap. */
export async function storageWouldExceed(db: Database, capMb: number, bytes: number): Promise<boolean> {
  return (await storageUsage(db)).usedBytes + bytes > capMb * BYTES_PER_MB;
}

/**
 * The share of the cap uploads may fill. The rest is kept for render output, so a burst of
 * uploads can't stop paid renders from saving their results.
 */
const UPLOAD_SHARE_OF_CAP = 0.9;

/** True when `bytes` more of uploads would pass their share of the cap. */
export function uploadWouldExceed(db: Database, capMb: number, bytes: number): Promise<boolean> {
  return storageWouldExceed(db, capMb * UPLOAD_SHARE_OF_CAP, bytes);
}

/** Where an account's uploads live: objectKeyFor puts every one under this prefix. */
export function uploadPrefixFor(clerkId: string): string {
  return `elevations/${clerkId}/`;
}

/** Bytes of one account's uploads (sources, references, selection masks) and their thumbnails. */
export async function uploadBytesFor(db: Database, clerkId: string): Promise<number> {
  const prefix = uploadPrefixFor(clerkId);
  // starts_with, not LIKE: Clerk ids contain "_", which LIKE treats as a wildcard.
  const [row] = await db
    .select({ bytes: sql<string>`coalesce(sum(${schema.storageObjects.bytes}), 0)::bigint` })
    .from(schema.storageObjects)
    .where(sql`starts_with(${schema.storageObjects.key}, ${prefix}) or starts_with(${schema.storageObjects.key}, ${thumbnailKeyPrefix(prefix)})`);
  return Number(row?.bytes ?? 0);
}

function thumbnailKeyPrefix(prefix: string): string {
  return `${THUMBNAIL_PREFIX}${prefix}`;
}

export interface StoredObject {
  body: ReadableStream;
  contentType: string;
}

/** What a GET is answered with: a stored object by key, or bytes made for this request only. */
export type ServedImage = { key: string } | StoredObject;

export async function getObject(env: Env, key: string): Promise<StoredObject | null> {
  const client = createStorageClient(env);
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: storageConfig(env).bucket, Key: key }));
    return {
      body: result.Body!.transformToWebStream(),
      contentType: result.ContentType ?? "application/octet-stream",
    };
  } catch (error) {
    if (error instanceof Error && error.name === "NoSuchKey") {
      return null;
    }
    throw error;
  }
}

/** Whether `key` is stored, without downloading it. */
export async function objectExists(env: Env, key: string): Promise<boolean> {
  try {
    await createStorageClient(env).send(new HeadObjectCommand({ Bucket: storageConfig(env).bucket, Key: key }));
    return true;
  } catch (error) {
    if (error instanceof Error && (error.name === "NotFound" || error.name === "NoSuchKey")) return false;
    throw error;
  }
}

/** The longest a presigned storage link may live (an S3 signing limit). */
const MAX_DIRECT_LINK_SECONDS = 60 * 60 * 24 * 7;
/** Direct links are signed at the start of this window, so repeat requests get the same link. */
const DIRECT_LINK_WINDOW_SECONDS = 60 * 60;

/**
 * A presigned link straight to `key` in the bucket, so the browser downloads the bytes from
 * storage rather than through an API function. It expires no later than `expires` (the signed
 * app link it stands in for). Also returns how long, in seconds, a redirect to it may be cached.
 */
export async function directObjectUrl(env: Env, key: string, expires: number, now = Math.floor(Date.now() / 1000)): Promise<{ url: string; maxAge: number }> {
  const signedAt = now - (now % DIRECT_LINK_WINDOW_SECONDS);
  const expiresIn = Math.max(1, Math.min(MAX_DIRECT_LINK_SECONDS, expires - signedAt));
  const url = await getSignedUrl(
    createStorageClient(env),
    // Objects never change once written, so the browser may keep its copy.
    new GetObjectCommand({ Bucket: storageConfig(env).bucket, Key: key, ResponseCacheControl: `private, max-age=${MAX_DIRECT_LINK_SECONDS}, immutable` }),
    { expiresIn, signingDate: new Date(signedAt * 1000) },
  );
  return { url, maxAge: Math.max(0, signedAt + expiresIn - now) };
}

export async function deleteObject(env: Env, key: string): Promise<void> {
  await createStorageClient(env).send(new DeleteObjectCommand({ Bucket: storageConfig(env).bucket, Key: key }));
  await createDb(env.DATABASE_URL).delete(schema.storageObjects).where(eq(schema.storageObjects.key, key));
}
