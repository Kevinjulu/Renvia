import sharp from "sharp";

/**
 * Pastes the masked area of an edited image onto the original source, so everything
 * outside the selection stays the original pixels. Instruction models (Kontext, Nano
 * Banana) edit far better than inpainting models but can't be restricted to an area —
 * this gives their quality with the selection's locality.
 */
export async function compositeMaskedEdit(source: Uint8Array, edited: Uint8Array, mask: Uint8Array): Promise<Buffer> {
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

  // Models return close to, but not exactly, the source size; stretch back onto it.
  // Flattened in its own pipeline: sharp applies removeAlpha() late, so chaining it with
  // joinChannel() would strip the mask channel that was just added.
  const editedRgb = await sharp(edited).rotate().resize(width, height, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const editedLayer = await sharp(editedRgb, { raw: { width, height, channels: 3 } })
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();

  return sharp(base, { raw: { width, height, channels: 3 } })
    .composite([{ input: editedLayer }])
    .jpeg({ quality: 92 })
    .toBuffer();
}
