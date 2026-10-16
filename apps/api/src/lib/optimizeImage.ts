import sharp, { type Metadata } from "sharp";

/**
 * Long edge an upload is stored at. The render models work at about one megapixel, so this
 * keeps every detail they can use (and a sharp canvas view) while a 12-50 MP phone photo
 * shrinks to a fraction of its size.
 */
export const MAX_UPLOAD_EDGE = 2560;
/** Long edge of the copy shown in grids, cards and tables: sharp at 2x on a ~300px tile. */
export const THUMBNAIL_EDGE = 640;
/** An opaque PNG still larger than this once capped is a photo saved as PNG, not a drawing. */
const LARGE_OPAQUE_PNG_BYTES = 3 * 1024 * 1024;
const LIMIT_INPUT_PIXELS = 150_000_000;

/** The bytes aren't an image sharp can read; `message` is safe to show the user. */
export class UnreadableImageError extends Error {
  constructor() {
    super("That file isn't a readable PNG, JPEG or WebP image.");
  }
}

export interface OptimizedImage {
  bytes: ArrayBuffer;
  contentType: string;
}

function arrayBufferOf(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

/**
 * Storage-ready copy of an upload: turned upright, capped at MAX_UPLOAD_EDGE and stripped of its
 * metadata (EXIF can carry the GPS location a photo was taken at).
 *
 * Quality policy:
 * - JPEG stays JPEG at quality 90 with full-resolution colour (4:4:4), visually lossless.
 * - PNG stays lossless PNG, so line elevations keep crisp edges and transparency survives. Only
 *   a large opaque PNG, which is a photo in practice, becomes a quality-92 JPEG.
 * - WebP stays WebP at quality 90, alpha kept.
 * The original is kept when re-encoding wouldn't shrink it and there is nothing to strip or fix.
 */
export async function optimizeUpload(input: ArrayBuffer, contentType: string): Promise<OptimizedImage> {
  const source = Buffer.from(input);
  let metadata: Metadata;
  try {
    metadata = await sharp(source, { limitInputPixels: LIMIT_INPUT_PIXELS }).metadata();
  } catch {
    throw new UnreadableImageError();
  }
  if (!metadata.width || !metadata.height) throw new UnreadableImageError();

  const oversized = Math.max(metadata.width, metadata.height) > MAX_UPLOAD_EDGE;
  const needsRotation = (metadata.orientation ?? 1) !== 1;
  let pipeline = sharp(source, { limitInputPixels: LIMIT_INPUT_PIXELS }).rotate();
  if (oversized) pipeline = pipeline.resize({ width: MAX_UPLOAD_EDGE, height: MAX_UPLOAD_EDGE, fit: "inside", withoutEnlargement: true, kernel: sharp.kernel.lanczos3 });

  let output: Buffer;
  let outputType = contentType;
  try {
    if (contentType === "image/jpeg") {
      output = await pipeline.jpeg({ quality: 90, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
    } else if (contentType === "image/webp") {
      output = await pipeline.webp({ quality: 90, alphaQuality: 100, smartSubsample: true }).toBuffer();
    } else {
      output = await pipeline.clone().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
      if (!metadata.hasAlpha && output.byteLength > LARGE_OPAQUE_PNG_BYTES) {
        output = await pipeline.clone().jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
        outputType = "image/jpeg";
      }
    }
  } catch {
    throw new UnreadableImageError();
  }

  if (!oversized && !needsRotation && !metadata.exif && output.byteLength >= input.byteLength) {
    return { bytes: input, contentType };
  }
  return { bytes: arrayBufferOf(output), contentType: outputType };
}

/** The small WebP copy shown wherever an image is a tile rather than the thing being looked at. */
export async function makeThumbnail(input: Uint8Array): Promise<ArrayBuffer> {
  const output = await sharp(input, { limitInputPixels: LIMIT_INPUT_PIXELS, failOn: "none" })
    .rotate()
    .resize({ width: THUMBNAIL_EDGE, height: THUMBNAIL_EDGE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
  return arrayBufferOf(output);
}
