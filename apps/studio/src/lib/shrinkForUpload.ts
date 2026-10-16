/**
 * Must match MAX_UPLOAD_EDGE in apps/api/src/lib/optimizeImage.ts: the API stores nothing larger,
 * so sending more pixels only makes the upload slower.
 */
const MAX_UPLOAD_EDGE = 2560;
/** Below this a photo uploads quickly as it is; the API still normalises it. */
const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;
const QUALITY = 0.92;

/**
 * A smaller copy of a large JPEG or WebP photo, made in the browser so less is sent over the
 * user's connection; the API then stores it without re-encoding again. Capped at
 * MAX_UPLOAD_EDGE, turned upright and stripped of metadata.
 *
 * PNG is sent untouched: it is how line elevations arrive, and they must stay lossless. Any
 * failure, or a copy that isn't smaller, falls back to the original file.
 */
export async function shrinkForUpload(file: File): Promise<File> {
  if ((file.type !== "image/jpeg" && file.type !== "image/webp") || file.size <= SHRINK_ABOVE_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    try {
      const scale = Math.min(1, MAX_UPLOAD_EDGE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext("2d");
      if (!context) return file;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, file.type, QUALITY));
      // Safari can't encode WebP and hands back a PNG instead, which would be larger.
      if (!blob || blob.type !== file.type || blob.size >= file.size) return file;
      return new File([blob], file.name, { type: file.type, lastModified: file.lastModified });
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}
