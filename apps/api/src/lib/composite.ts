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

/** Bounding box of the selected (white) pixels, in source pixels; null when nothing is selected. */
export async function selectionBox(source: Uint8Array, mask: Uint8Array): Promise<{ box: CropRect; width: number; height: number } | null> {
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
  return { box: { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 }, width, height };
}

/**
 * The part of the source a masked edit should send to the model: the selection's bounding
 * box plus surrounding context. A close-up gives the model far more pixels for a door or a
 * window than the whole elevation would. Null when the selection is empty or already covers
 * most of the image. Deterministic, so the result step recomputes the same rectangle.
 */
export async function editCropFor(source: Uint8Array, mask: Uint8Array): Promise<CropRect | null> {
  const selection = await selectionBox(source, mask);
  return selection ? cropAround(selection.box, selection.width, selection.height) : null;
}

function cropAround(box: CropRect, width: number, height: number): CropRect | null {
  const context = Math.round(Math.max(box.width, box.height) * CONTEXT_RATIO);
  const minSide = Math.min(MIN_CROP_SIDE, width, height);
  const [left, cropWidth] = growSpan(box.left, box.width, Math.max(box.width + 2 * context, minSide), width);
  const [top, cropHeight] = growSpan(box.top, box.height, Math.max(box.height + 2 * context, minSide), height);

  if (cropWidth * cropHeight > MAX_CROP_AREA_SHARE * width * height) return null;
  return { left, top, width: cropWidth, height: cropHeight };
}

/** A selection spanning more than this share of the frame on both axes has no useful "where". */
const PLACEMENT_MAX_SPAN = 0.6;

/**
 * Where the selection sits in the image the model is given (the crop, or the whole source), in
 * words: "in the centre", "in the lower left". Null when it fills most of that image, where a
 * position would only mislead.
 */
export function selectionPlacement(box: CropRect, frame: CropRect): string | null {
  if (box.width > PLACEMENT_MAX_SPAN * frame.width && box.height > PLACEMENT_MAX_SPAN * frame.height) return null;
  const third = (centre: number, start: number, size: number) => {
    const share = (centre - start) / size;
    return share < 0.36 ? 0 : share > 0.64 ? 2 : 1;
  };
  const column = third(box.left + box.width / 2, frame.left, frame.width);
  const row = third(box.top + box.height / 2, frame.top, frame.height);
  if (row === 1 && column === 1) return "in the centre";
  const vertical = ["upper", "", "lower"][row]!;
  const horizontal = ["left", "", "right"][column]!;
  if (!horizontal) return row === 0 ? "at the top" : "at the bottom";
  if (!vertical) return `on the ${horizontal}`;
  return `in the ${vertical} ${horizontal}`;
}

/** What a selection edit needs: the crop sent to the model, and where the selection sits in it. */
export async function selectionFraming(source: Uint8Array, mask: Uint8Array): Promise<{ crop: CropRect | null; placement: string | null }> {
  const selection = await selectionBox(source, mask);
  if (!selection) return { crop: null, placement: null };
  const crop = cropAround(selection.box, selection.width, selection.height);
  const frame = crop ?? { left: 0, top: 0, width: selection.width, height: selection.height };
  return { crop, placement: selectionPlacement(selection.box, frame) };
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
