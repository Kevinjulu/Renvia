/**
 * Deletes watermarked copies and thumbnails made with earlier watermark designs. They are no longer
 * served (links resolve to the current version) but stay in storage until removed here.
 *
 * Only keys that obsoleteWatermarkVersion() recognises are touched: copies and thumbnails of render
 * outputs from a version older than WATERMARK_VERSION. Originals, uploads, other thumbnails, stock
 * and feedback can never match. The bucket is listed, not the ledger, because objects stored before
 * the ledger existed are only in the bucket.
 *
 *   node --env-file=.env.local scripts/cleanup-watermarks.ts                   # dry run: report only
 *   node --env-file=.env.local scripts/cleanup-watermarks.ts --reclassify      # fix ledger kinds only
 *   node --env-file=.env.local scripts/cleanup-watermarks.ts --apply --confirm <count>
 *
 * --apply deletes, and needs --confirm with the exact count the dry run reported, so a stale
 * confirmation can't delete more than was reviewed. It refuses until CLEANUP_GRACE_MS after the
 * current version first stored a copy. Safe to repeat: deleting a missing key is a no-op.
 * --reclassify marks versioned watermark copies recorded as uploads (before the storageKindFor
 * fix) as watermarks in storage_objects. It deletes nothing.
 */
import { neon } from "@neondatabase/serverless";
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { cleanupAllowedFrom, obsoleteWatermarkVersion, WATERMARK_DERIVED_PREFIXES, WATERMARK_VERSION } from "../src/lib/watermarkVersions.ts";

const BATCH = 1000; // DeleteObjects' maximum per request

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

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const reclassify = args.includes("--reclassify");
const confirmed = args.includes("--confirm") ? Number(args[args.indexOf("--confirm") + 1]) : null;

const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;

// 1. Every obsolete object in the bucket, grouped by version and kind.
const obsolete: { key: string; bytes: number }[] = [];
const groups = new Map<string, { count: number; bytes: number; samples: string[] }>();
for (const prefix of WATERMARK_DERIVED_PREFIXES) {
  let token: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const object of page.Contents ?? []) {
      const key = object.Key;
      const version = key ? obsoleteWatermarkVersion(key) : null;
      // The prefixes don't overlap, so each key is seen once.
      if (!key || version === null) continue;
      obsolete.push({ key, bytes: object.Size ?? 0 });
      // Unversioned keys predate versioned names: copies from the first design, and thumbnails
      // from before thumbnails were named after the version they were made from.
      const label = `${/^(thumbs\/)?watermarked\//.test(key) ? "unversioned" : `v${version}`} ${key.startsWith("thumbs/") ? "thumbnails" : "copies"}`;
      const group = groups.get(label) ?? { count: 0, bytes: 0, samples: [] };
      group.count += 1;
      group.bytes += object.Size ?? 0;
      if (group.samples.length < 3) group.samples.push(key);
      groups.set(label, group);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}

const total = obsolete.reduce((sum, o) => sum + o.bytes, 0);
console.log(`Current watermark version: ${WATERMARK_VERSION}. Obsolete objects: ${obsolete.length} (${mb(total)}).\n`);
for (const [label, group] of [...groups].sort()) {
  console.log(`  ${label}: ${group.count} (${mb(group.bytes)})`);
  for (const sample of group.samples) console.log(`      e.g. ${sample}`);
}

// 2. Ledger rows recorded with the wrong kind.
const [{ count: misclassified }] = (await sql`select count(*)::int as count from storage_objects where key ~ '^watermarked-v[0-9]+/' and kind <> 'watermark'`) as { count: number }[];
console.log(`\nLedger rows for watermark copies recorded under another kind: ${misclassified}`);
if (reclassify && misclassified > 0) {
  const updated = await sql`update storage_objects set kind = 'watermark' where key ~ '^watermarked-v[0-9]+/' and kind <> 'watermark' returning key`;
  console.log(`  reclassified ${updated.length} rows as watermark`);
}

// 3. When deleting is allowed: CLEANUP_GRACE_MS after the current version first stored a copy.
const [{ first }] = (await sql`select min(created_at) as first from storage_objects where key like ${`watermarked-v${WATERMARK_VERSION}/%`}`) as { first: string | null }[];
const allowedFrom = first ? cleanupAllowedFrom(new Date(first)) : null;
console.log(
  allowedFrom
    ? `\nVersion ${WATERMARK_VERSION} first stored a copy at ${new Date(first!).toISOString()}; deleting is allowed from ${allowedFrom.toISOString()}.`
    : `\nVersion ${WATERMARK_VERSION} hasn't stored a copy yet, so it isn't live; deleting is not allowed.`,
);

if (!apply) {
  console.log(`\nDry run. To delete: --apply --confirm ${obsolete.length}`);
  process.exit(0);
}
if (!allowedFrom || Date.now() < allowedFrom.getTime()) throw new Error("Refusing to delete: the grace period after the current version went live hasn't passed.");
if (confirmed !== obsolete.length) throw new Error(`Refusing to delete: --confirm ${confirmed ?? "(missing)"} doesn't match the ${obsolete.length} obsolete objects found now.`);

// 4. Delete in batches; a key's ledger row goes only once the bucket confirms its deletion.
let deleted = 0, freed = 0;
for (let i = 0; i < obsolete.length; i += BATCH) {
  const batch = obsolete.slice(i, i + BATCH);
  const result = await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map(({ key }) => ({ Key: key })), Quiet: true } }));
  const failed = new Set((result.Errors ?? []).map((error) => error.Key));
  for (const error of result.Errors ?? []) console.log(`  failed ${error.Key}: ${error.Code} ${error.Message}`);
  const done = batch.filter(({ key }) => !failed.has(key));
  await sql`delete from storage_objects where key = any(${done.map(({ key }) => key)})`;
  deleted += done.length;
  freed += done.reduce((sum, o) => sum + o.bytes, 0);
  console.log(`  batch ${i / BATCH + 1}: deleted ${done.length} of ${batch.length}`);
}
console.log(`\nDeleted ${deleted} of ${obsolete.length} obsolete objects, freeing ${mb(freed)}.`);
