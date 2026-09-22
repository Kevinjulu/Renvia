import sharp from "sharp";

/** A region of the (EXIF-rotated) source image, in pixels. */
export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Mask pixels brighter than this count as selected. */
const MASK_THRESHOLD = 127;
/** Context kept around the selection, as a fraction of its longer side, so the model sees what it's editing. */
const CONTEXT_RATIO = 0.6;
/**
 * Smallest crop side — tiny selections still get enough surroundings to match light and
 * style. Was 448: for a single small window (~124x105) that floor forced a 448x448 crop
 * where the selected object was only ~6.5% of the frame, diluting the instruction's visual
 * target so badly the model regularly missed it. 320 keeps enough context for lighting/
 * material matching without burying a modest selection in mostly-irrelevant surroundings.
 */
const MIN_CROP_SIDE = 320;
/** Past this share of the image, cropping gains little detail; the model gets the whole image instead. */
const MAX_CROP_AREA_SHARE = 0.65;

/** Width/height of the source as the browser shows it (EXIF orientations 5–8 swap the axes). */
async function orientedSize(source: Uint8Array): Promise<{ width: number; height: number }> {
  const { width = 0, height = 0, orientation = 1 } = await sharp(source).metadata();
  return orientation >= 5 ? { width: height, height: width } : { width, height };
}

/** Grows [start, start+size) to `target` around its centre, kept inside [0, limit). */
function growSpan(start: number, size: number, target: number, limit: number): [number, number] {
  const length = Math.min(limit, Math.max(size, target));
  const centre = start + size / 2;
  const begin = Math.min(Math.max(0, Math.round(centre - length / 2)), limit - length);
  return [begin, length];
}

/**
 * The part of the source a masked edit should send to the model: the selection's bounding
 * box plus surrounding context. A close-up gives the model far more pixels for a door or a
 * window than the whole elevation would. Null when the selection is empty or already covers
 * most of the image. Deterministic, so the result step recomputes the same rectangle.
 */
export async function editCropFor(source: Uint8Array, mask: Uint8Array): Promise<CropRect | null> {
  const { width, height } = await orientedSize(source);
  if (!width || !height) return null;

  const pixels = await sharp(mask).resize(width, height, { fit: "fill" }).removeAlpha().greyscale().extractChannel(0).raw().toBuffer();
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (pixels[row + x]! > MASK_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;

  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;
  const context = Math.round(Math.max(boxWidth, boxHeight) * CONTEXT_RATIO);
  const minSide = Math.min(MIN_CROP_SIDE, width, height);
  const [left, cropWidth] = growSpan(minX, boxWidth, Math.max(boxWidth + 2 * context, minSide), width);
  const [top, cropHeight] = growSpan(minY, boxHeight, Math.max(boxHeight + 2 * context, minSide), height);

  if (cropWidth * cropHeight > MAX_CROP_AREA_SHARE * width * height) return null;
  return { left, top, width: cropWidth, height: cropHeight };
}

/** The crop of the (EXIF-rotated) source that the model edits. */
export function cropSource(source: Uint8Array, crop: CropRect): Promise<Buffer> {
  return sharp(source).rotate().extract(crop).jpeg({ quality: 95 }).toBuffer();
}

/**
 * Pastes the masked area of an edited image onto the original source, so everything
 * outside the selection stays the original pixels. Instruction models (Kontext, Nano
 * Banana) edit far better than inpainting models but can't be restricted to an area —
 * this gives their quality with the selection's locality. With `crop`, `edited` is the
 * model's version of just that region and is placed back where it was cut from.
 */
export async function compositeMaskedEdit(source: Uint8Array, edited: Uint8Array, mask: Uint8Array, crop?: CropRect | null): Promise<Buffer> {
  // rotate() applies EXIF orientation, matching how the browser displayed the image
  // when the selection mask was drawn at its natural size.
  const { data: base, info } = await sharp(source).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  // A soft edge hides the seam; scaled with the image so it looks the same at any size.
  const featherSigma = Math.max(1, Math.round(width / 400));
  const alpha = await sharp(mask)
    .resize(width, height, { fit: "fill" })
    .removeAlpha()
    .greyscale()
    .extractChannel(0)
    .blur(featherSigma)
    .raw()
    .toBuffer();

  // Models return close to, but not exactly, the size they were given; stretch back onto it.
  // Flattened in its own pipeline: sharp applies removeAlpha() late, so chaining it with
  // joinChannel() would strip the mask channel that was just added.
  let editedRgb: Buffer;
  if (crop) {
    const region = await sharp(edited).rotate().resize(crop.width, crop.height, { fit: "fill" }).removeAlpha().png().toBuffer();
    editedRgb = await sharp(base, { raw: { width, height, channels: 3 } })
      .composite([{ input: region, left: crop.left, top: crop.top }])
      .removeAlpha()
      .raw()
      .toBuffer();
  } else {
    editedRgb = await sharp(edited).rotate().resize(width, height, { fit: "fill" }).removeAlpha().raw().toBuffer();
  }
  const editedLayer = await sharp(editedRgb, { raw: { width, height, channels: 3 } })
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();

  return sharp(base, { raw: { width, height, channels: 3 } })
    .composite([{ input: editedLayer }])
    .jpeg({ quality: 92 })
    .toBuffer();
}
