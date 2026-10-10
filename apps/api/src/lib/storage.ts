import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Env } from "../index.js";

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

/** The first pass of a two-pass edit, kept apart from the final result it feeds. */
export function renderIntermediateKeyFor(renderId: string, contentType: string): string {
  return `renders/${renderId}-selection.${requireExtension(contentType)}`;
}

// The whole app is mounted under "/api" for Vercel's api/ directory convention
// (see apps/api/api/[...route].ts), so served objects live under this prefix.
const UPLOADS_PATH = "/api/uploads/";
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * Keep media reachable if an older deployment has not yet been given the
 * dedicated signing secret. The storage credential is server-only and has the
 * same entropy requirements, while a dedicated key can still be configured to
 * decouple future media-link rotations from storage credential rotation.
 */
function storageSigningSecret(env: Env): string {
  return env.STORAGE_URL_SIGNING_SECRET?.trim() || env.NEON_STORAGE_SECRET_ACCESS_KEY;
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

/** A browser-safe link that expires, so the storage bucket is not an anonymous public CDN. */
export async function signedUploadUrl(env: Env, origin: string, key: string): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
  const signature = base64Url(await signatureFor(storageSigningSecret(env), key, expires));
  const url = new URL(publicUploadUrl(origin, key));
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signature);
  return url.toString();
}

/** Re-sign one of our persisted URLs; external links are returned unchanged. */
export function presentUploadUrl(env: Env, origin: string, url: string): Promise<string>;
export function presentUploadUrl(env: Env, origin: string, url: null): Promise<null>;
export function presentUploadUrl(env: Env, origin: string, url: string | null): Promise<string | null>;
export async function presentUploadUrl(env: Env, origin: string, url: string | null): Promise<string | null> {
  if (!url) return null;
  const key = ownUploadKey(url, origin);
  return key ? signedUploadUrl(env, origin, key) : url;
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
  return new S3Client({
    region: env.NEON_STORAGE_REGION,
    endpoint: env.NEON_STORAGE_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.NEON_STORAGE_ACCESS_KEY_ID,
      secretAccessKey: env.NEON_STORAGE_SECRET_ACCESS_KEY,
    },
  });
}

export async function putObject(env: Env, key: string, bytes: ArrayBuffer, contentType: string): Promise<void> {
  const client = createStorageClient(env);
  await client.send(
    new PutObjectCommand({
      Bucket: env.NEON_STORAGE_BUCKET,
      Key: key,
      Body: new Uint8Array(bytes),
      ContentType: contentType,
    }),
  );
}

export interface StoredObject {
  body: ReadableStream;
  contentType: string;
}

export async function getObject(env: Env, key: string): Promise<StoredObject | null> {
  const client = createStorageClient(env);
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: env.NEON_STORAGE_BUCKET, Key: key }));
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

export async function deleteObject(env: Env, key: string): Promise<void> {
  await createStorageClient(env).send(new DeleteObjectCommand({ Bucket: env.NEON_STORAGE_BUCKET, Key: key }));
}
