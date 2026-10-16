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
/** An image within MAX_UPLOAD_EDGE and this size with nothing to fix is stored as sent. */
const STORE_AS_SENT_BYTES = 3 * 1024 * 1024;
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
 * The original is kept when it is already small, or re-encoding wouldn't shrink it, and there is
 * nothing to strip or fix.
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
  const hasMetadata = Boolean(metadata.exif || metadata.xmp || metadata.iptc);
  // Already small, upright and clean, like a copy the Studio shrank before sending: encoding it
  // again would only cost a second generation of JPEG loss.
  if (!oversized && !needsRotation && !hasMetadata && input.byteLength <= STORE_AS_SENT_BYTES) {
    return { bytes: input, contentType };
  }
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

  if (oversized || needsRotation) return { bytes: arrayBufferOf(output), contentType: outputType };
  // Same pixels either way, so keep whichever is smaller. A JPEG's metadata is cut out without
  // re-encoding, so a small, already-compressed photo never grows just to lose its EXIF.
  const asSent = (contentType === "image/jpeg" && withoutJpegMetadata(source)) || input;
  return output.byteLength < asSent.byteLength ? { bytes: arrayBufferOf(output), contentType: outputType } : { bytes: asSent, contentType };
}

/** APP1 holds EXIF (including GPS) and XMP; APP13 holds IPTC. The ICC profile (APP2) is kept. */
const JPEG_METADATA_MARKERS = new Set([0xe1, 0xed]);

/**
 * The JPEG with its metadata segments removed and its image data untouched, or null if the
 * header can't be walked safely.
 */
function withoutJpegMetadata(jpeg: Buffer): ArrayBuffer | null {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  const kept: Buffer[] = [jpeg.subarray(0, 2)];
  let offset = 2;
  while (offset + 4 <= jpeg.length) {
    if (jpeg[offset] !== 0xff) return null;
    const marker = jpeg[offset + 1]!;
    // Start of scan: the compressed image data runs from here to the end of the file.
    if (marker === 0xda) {
      kept.push(jpeg.subarray(offset));
      return arrayBufferOf(Buffer.concat(kept));
    }
    const length = jpeg.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > jpeg.length) return null;
    if (!JPEG_METADATA_MARKERS.has(marker)) kept.push(jpeg.subarray(offset, offset + 2 + length));
    offset += 2 + length;
  }
  return null;
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
