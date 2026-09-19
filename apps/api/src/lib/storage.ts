import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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

// The whole app is mounted under "/api" for Vercel's api/ directory convention
// (see apps/api/api/[...route].ts), so served objects live under this prefix.
const UPLOADS_PATH = "/api/uploads/";

export function publicUploadUrl(origin: string, key: string): string {
  return `${origin}${UPLOADS_PATH}${key}`;
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

/** The first `length` bytes of an object — enough for image headers without a full download. */
export async function getObjectPrefix(env: Env, key: string, length: number): Promise<Uint8Array | null> {
  const client = createStorageClient(env);
  try {
    const result = await client.send(
      new GetObjectCommand({ Bucket: env.NEON_STORAGE_BUCKET, Key: key, Range: `bytes=0-${length - 1}` }),
    );
    return result.Body!.transformToByteArray();
  } catch (error) {
    if (error instanceof Error && error.name === "NoSuchKey") {
      return null;
    }
    throw error;
  }
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
