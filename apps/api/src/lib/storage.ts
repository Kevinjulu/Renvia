import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Env } from "../index";

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function extensionForContentType(contentType: string): string | null {
  return EXTENSION_BY_CONTENT_TYPE[contentType] ?? null;
}

export function objectKeyFor(clerkId: string, contentType: string): string {
  const extension = extensionForContentType(contentType);
  if (!extension) {
    throw new Error(`Unsupported content type: ${contentType}`);
  }
  return `elevations/${clerkId}/${crypto.randomUUID()}.${extension}`;
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
