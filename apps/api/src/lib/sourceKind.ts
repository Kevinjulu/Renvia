import sharp from "sharp";
import type { RenderSourceType } from "@renvia/types";
import type { Env } from "../index.js";
import { getObject, ownUploadKey } from "./storage.js";

/**
 * Decides whether an uploaded source image is a line drawing (a CAD or hand elevation) or a
 * photograph / 3D / photoreal image, so the person never has to say. The answer only changes the
 * wording of the instruction sent to the model (see prompts.ts): drawings are told to follow the
 * lines exactly, photographs are re-rendered.
 *
 * The two mistakes are not equal. Calling a drawing a photo loses "follow these lines", which
 * hurts the main elevation workflow; calling a photo a drawing is merely the previous default. So
 * "drawing" is the default and "photo" needs positive evidence. Tuned and checked against real
 * elevations, photographs and renders plus scanned, tinted, noisy, margined and grayscale
 * variants of them (see test/sourceKind.test.ts).
 */

/** Longest edge analysed. Large enough that dense hatching still reads as ink on paper. */
const ANALYSIS_EDGE = 640;

/** Share of the content that must sit in one tone for it to count as paper. */
const LINE_ART_DOMINANT_SHARE = 0.45;
/** Paper is light; a dominant dark tone (a night sky) is not a drawing. */
const LINE_ART_MIN_TONE = 170;
/** Below this mean saturation the image is grey; a single hue (a scan's tint) counts as grey too. */
const GREY_SATURATION = 0.04;
const TINT_HUE_CONCENTRATION = 0.97;
/** Photo evidence: how little of the image may sit in one tone, and how many tones it must use. */
const COLOUR_PHOTO = { maxDominantShare: 0.4, minToneVariety: 20 };
/** Grey images need stronger evidence, because grey CAD drawings and grayscale photos look alike. */
const GREY_PHOTO = { maxDominantShare: 0.22, minToneVariety: 24 };

export interface SourceSignals {
  /** Share of the content area inside the single most common 16-level tone band. */
  dominantShare: number;
  /** Centre of that band, 0 (black) to 255 (white), after contrast stretching. */
  dominantTone: number;
  /** Mean colour saturation, 0 to 1. */
  saturation: number;
  /** How many of 32 tone bands hold a meaningful share of pixels. */
  toneVariety: number;
  /** 1 means every coloured pixel shares one hue (a tint); photographs are lower. */
  hueConcentration: number;
}

/** Measures the signals from raw interleaved RGB(A) pixels. Pure, so it can be tested directly. */
export function measureSourceSignals(pixels: Uint8Array, width: number, height: number, channels: number): SourceSignals {
  const count = width * height;
  const lum = new Float32Array(count);
  const sat = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = pixels[i * channels]!, g = pixels[i * channels + 1]!, b = pixels[i * channels + 2]!;
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    const max = Math.max(r, g, b);
    sat[i] = max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
  }

  // Stretch the 1st to 99th percentile to full range so a washed-out photo is not mistaken for paper.
  const levels = new Float32Array(256);
  for (let i = 0; i < count; i++) levels[Math.min(255, Math.round(lum[i]!))]!++;
  const percentile = (q: number) => {
    let seen = 0;
    for (let v = 0; v < 256; v++) {
      seen += levels[v]!;
      if (seen >= q * count) return v;
    }
    return 255;
  };
  const low = percentile(0.01), high = percentile(0.99);
  if (high - low >= 30) {
    for (let i = 0; i < count; i++) lum[i] = Math.max(0, Math.min(255, ((lum[i]! - low) / (high - low)) * 255));
  }

  // Judge only the content: trim a uniform border (white margins around a photo, a desk around a sheet).
  const frame = Math.max(2, Math.round(Math.min(width, height) * 0.02));
  const frameLevels = new Float32Array(256);
  let frameCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x < frame || y < frame || x >= width - frame || y >= height - frame) {
        frameLevels[Math.min(255, Math.round(lum[y * width + x]!))]!++;
        frameCount++;
      }
    }
  }
  let background = 255;
  for (let v = 0, seen = 0; v < 256; v++) {
    seen += frameLevels[v]!;
    if (seen >= frameCount / 2) {
      background = v;
      break;
    }
  }
  const rowHits = new Int32Array(height), colHits = new Int32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (Math.abs(lum[y * width + x]! - background) > 28) {
        rowHits[y]!++;
        colHits[x]!++;
      }
    }
  }
  const rowHasContent = (y: number) => rowHits[y]! >= width * 0.01;
  const colHasContent = (x: number) => colHits[x]! >= height * 0.01;
  let top = 0, bottom = height - 1, left = 0, right = width - 1;
  while (top < bottom && !rowHasContent(top)) top++;
  while (bottom > top && !rowHasContent(bottom)) bottom--;
  while (left < right && !colHasContent(left)) left++;
  while (right > left && !colHasContent(right)) right--;
  const padY = Math.round(height * 0.01), padX = Math.round(width * 0.01);
  top = Math.max(0, top - padY);
  bottom = Math.min(height - 1, bottom + padY);
  left = Math.max(0, left - padX);
  right = Math.min(width - 1, right + padX);
  // A tiny speck of content on an otherwise empty sheet is not enough to judge: use the whole image.
  if ((right - left + 1) * (bottom - top + 1) < count * 0.25) {
    top = 0;
    bottom = height - 1;
    left = 0;
    right = width - 1;
  }

  const area = (right - left + 1) * (bottom - top + 1);
  const histogram = new Float32Array(256);
  let satSum = 0, hueCos = 0, hueSin = 0, hueCount = 0;
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const i = y * width + x;
      histogram[Math.min(255, Math.round(lum[i]!))]!++;
      satSum += sat[i]!;
      if (sat[i]! >= 0.08) {
        const r = pixels[i * channels]!, g = pixels[i * channels + 1]!, b = pixels[i * channels + 2]!;
        const hue = Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b);
        hueCos += Math.cos(hue);
        hueSin += Math.sin(hue);
        hueCount++;
      }
    }
  }
  let bestCount = 0, bestStart = 0;
  for (let start = 0; start <= 240; start++) {
    let total = 0;
    for (let k = 0; k < 16; k++) total += histogram[start + k]!;
    if (total > bestCount) {
      bestCount = total;
      bestStart = start;
    }
  }
  let toneVariety = 0;
  for (let start = 0; start < 256; start += 8) {
    let total = 0;
    for (let k = 0; k < 8; k++) total += histogram[start + k]!;
    if (total / area > 0.003) toneVariety++;
  }

  return {
    dominantShare: bestCount / area,
    dominantTone: bestStart + 8,
    saturation: satSum / area,
    toneVariety,
    // Too few coloured pixels to say: treat as a single hue, i.e. not evidence of a photograph.
    hueConcentration: hueCount >= area * 0.02 ? Math.hypot(hueCos, hueSin) / hueCount : 1,
  };
}

/** "drawing" unless the signals clearly describe a photograph. */
export function decideSourceType(signals: SourceSignals): RenderSourceType {
  if (signals.dominantShare >= LINE_ART_DOMINANT_SHARE && signals.dominantTone >= LINE_ART_MIN_TONE) return "drawing";
  const colourful = signals.saturation >= GREY_SATURATION && signals.hueConcentration < TINT_HUE_CONCENTRATION;
  const evidence = colourful ? COLOUR_PHOTO : GREY_PHOTO;
  return signals.dominantShare <= evidence.maxDominantShare && signals.toneVariety >= evidence.minToneVariety ? "photo" : "drawing";
}

export async function classifySourceImage(bytes: Uint8Array): Promise<{ kind: RenderSourceType; signals: SourceSignals }> {
  const { data, info } = await sharp(bytes, { limitInputPixels: 150_000_000, failOn: "none" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize(ANALYSIS_EDGE, ANALYSIS_EDGE, { fit: "inside" })
    // A median removes scan noise and JPEG speckle without smearing line edges the way a blur would.
    .median(3)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const signals = measureSourceSignals(data, info.width, info.height, info.channels);
  return { kind: decideSourceType(signals), signals };
}

/**
 * The kind of one of our own uploaded source images. Never throws and never reads a client-supplied
 * URL: anything that cannot be analysed is a "drawing", the studio's long-standing default.
 */
export async function detectSourceType(env: Env, sourceImageUrl: string, origin: string): Promise<RenderSourceType> {
  try {
    const key = ownUploadKey(sourceImageUrl, origin);
    if (!key) return "drawing";
    const object = await getObject(env, key);
    if (!object) return "drawing";
    return (await classifySourceImage(new Uint8Array(await new Response(object.body).arrayBuffer()))).kind;
  } catch (error) {
    console.error(JSON.stringify({ level: "warn", event: "render.source_kind_failed", error: error instanceof Error ? error.message : String(error) }));
    return "drawing";
  }
}
