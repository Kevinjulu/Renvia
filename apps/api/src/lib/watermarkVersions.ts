/**
 * Watermark versions, and which stored objects belong to versions no longer served. No imports,
 * so maintenance scripts can load it directly (see scripts/cleanup-watermarks.ts).
 */

// Bump when the overlay changes, so copies made with an earlier design are remade on next open.
// 2: RENVIA artwork. 3: RAMAH STUDIO artwork on the same grid.
export const WATERMARK_VERSION = 3;

/** Bucket prefixes under which watermarked copies and their thumbnails have ever been stored. */
export const WATERMARK_DERIVED_PREFIXES = ["watermarked/", "watermarked-v", "thumbs/watermarked/", "thumbs/watermarked-v"] as const;

/**
 * Wait this long after a version goes live before deleting earlier versions' copies: a browser
 * may hold a redirect to an old copy for as long as a watermarked link lasts (7 days).
 */
export const CLEANUP_GRACE_MS = 8 * 24 * 60 * 60 * 1000;

const COPY = /^watermarked(?:-v(\d+))?\/renders\/[^/]+$/;
const THUMBNAIL = /^thumbs\/watermarked(?:-v(\d+))?\/renders\/[^/]+\.webp$/;

/**
 * The version of a stored watermarked copy or its thumbnail when that version is older than
 * `current`, else null. Unversioned keys are version 1. Anything that isn't a watermarked render
 * output (originals, uploads, other thumbnails, stock, feedback) is never obsolete.
 */
export function obsoleteWatermarkVersion(key: string, current = WATERMARK_VERSION): number | null {
  const match = COPY.exec(key) ?? THUMBNAIL.exec(key);
  if (!match) return null;
  const version = match[1] === undefined ? 1 : Number(match[1]);
  return version < current ? version : null;
}

/** The earliest moment earlier versions may be deleted, given when the current one first stored a copy. */
export function cleanupAllowedFrom(currentVersionFirstStoredAt: Date): Date {
  return new Date(currentVersionFirstStoredAt.getTime() + CLEANUP_GRACE_MS);
}
