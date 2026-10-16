/**
 * Re-encodes user uploads stored before upload compression existed, with the same
 * optimizeUpload the upload route now uses: upright, capped at 2560px, metadata stripped.
 * Keys stay the same, so every stored URL keeps working; only the bytes and Content-Type change.
 * Selection masks referenced by renders are left untouched.
 *
 *   node --env-file=.env.local scripts/backfill-images.ts                  # dry run: report only
 *   node --env-file=.env.local scripts/backfill-images.ts --apply <backupDir>
 *
 * --apply writes each original to <backupDir> before overwriting it in storage.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { neon } from "@neondatabase/serverless";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { optimizeUpload, UnreadableImageError } from "../src/lib/optimizeImage.ts";

const UPLOAD_PREFIX = "elevations/";
const UPLOADS_PATH = "/api/uploads/";

const env = process.env;
const pick = (value?: string, fallback?: string) => value?.trim() || fallback?.trim() || "";
const bucket = pick(env.STORAGE_BUCKET, env.NEON_STORAGE_BUCKET);
const client = new S3Client({
  region: pick(env.STORAGE_REGION, env.NEON_STORAGE_REGION) || "auto",
  endpoint: pick(env.STORAGE_ENDPOINT, env.NEON_STORAGE_ENDPOINT),
  forcePathStyle: true,
  credentials: {
    accessKeyId: pick(env.STORAGE_ACCESS_KEY_ID, env.NEON_STORAGE_ACCESS_KEY_ID),
    secretAccessKey: pick(env.STORAGE_SECRET_ACCESS_KEY, env.NEON_STORAGE_SECRET_ACCESS_KEY),
  },
});
const sql = neon(env.DATABASE_URL!);

const apply = process.argv.includes("--apply");
const backupDir = apply ? process.argv[process.argv.indexOf("--apply") + 1] : undefined;
if (apply && !backupDir) throw new Error("--apply needs a backup directory for the originals");

function keyOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const { pathname } = new URL(url);
    return pathname.startsWith(UPLOADS_PATH) ? decodeURIComponent(pathname.slice(UPLOADS_PATH.length)) : null;
  } catch {
    return null;
  }
}

async function listUploadKeys(): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: UPLOAD_PREFIX, ContinuationToken: token }));
    for (const object of page.Contents ?? []) if (object.Key) keys.push(object.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

const maskRows = await sql`select settings->'edit'->>'maskImageUrl' as url from renders where settings->'edit'->>'maskImageUrl' is not null`;
const masks = new Set(maskRows.map((row) => keyOf(row.url as string)).filter(Boolean));
const keys = await listUploadKeys();
console.log(`${keys.length} uploads. ${apply ? `Applying; originals saved to ${backupDir}` : "Dry run"}\n`);

let before = 0;
let after = 0;
let changed = 0;
let skippedMasks = 0;
for (const key of keys) {
  if (masks.has(key)) {
    skippedMasks += 1;
    continue;
  }
  const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const contentType = object.ContentType ?? "";
  const bytes = await object.Body!.transformToByteArray();
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  before += input.byteLength;

  let output;
  try {
    output = await optimizeUpload(input, contentType);
  } catch (error) {
    if (!(error instanceof UnreadableImageError)) throw error;
    console.log(`skip  ${key}: unreadable`);
    after += input.byteLength;
    continue;
  }
  after += output.bytes.byteLength;
  if (output.bytes === input) continue;

  changed += 1;
  const kb = (n: number) => `${Math.round(n / 1024)} KB`;
  console.log(`${apply ? "write" : "would"} ${key}: ${kb(input.byteLength)} ${contentType} -> ${kb(output.bytes.byteLength)} ${output.contentType}`);
  if (!apply) continue;

  const backupPath = join(backupDir!, key);
  await mkdir(dirname(backupPath), { recursive: true });
  await writeFile(backupPath, bytes);
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: new Uint8Array(output.bytes), ContentType: output.contentType }));
  await sql`
    insert into storage_objects (key, bytes, content_type, kind) values (${key}, ${output.bytes.byteLength}, ${output.contentType}, 'upload')
    on conflict (key) do update set bytes = excluded.bytes, content_type = excluded.content_type`;
}

const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
console.log(`\n${changed} of ${keys.length - skippedMasks} uploads ${apply ? "re-encoded" : "would be re-encoded"}: ${mb(before)} -> ${mb(after)} (${skippedMasks} masks untouched)`);
