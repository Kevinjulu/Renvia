import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { classifySourceImage } from "../src/lib/sourceKind.js";

// Pure image analysis: no database (setup.ts skips the reset for *.pure.test.ts files).
// Fixtures are real elevations (line drawings) and real photographs / photoreal renders.
// Variants imitate how people actually upload them: scanned, tinted, noisy, margined, grayscale.

const fixtures = fileURLToPath(new URL("../../../tests/render-fidelity/fixtures/", import.meta.url));
const list = (dir: string) => readdirSync(join(fixtures, dir)).map((name) => ({ name, path: join(fixtures, dir, name) }));
const DRAWINGS = list("Test Elevation");
const PHOTOS = [...list("Rendered Results"), ...list("test reference images")];
const load = (path: string) => new Uint8Array(readFileSync(path));
const fixture = (dir: string, name: string) => load(join(fixtures, dir, name));

/** Small deterministic noise so the variant tests do not flake. */
function noisy(buffer: Buffer, sigma: number): Buffer {
  let state = 12345;
  const rand = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out = Buffer.from(buffer);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, out[i]! + (rand() + rand() + rand() - 1.5) * 2 * sigma));
  return out;
}

async function raw(bytes: Uint8Array) {
  // Variants are built from a modest copy: the detector itself works on a reduced image anyway.
  const { data, info } = await sharp(bytes).rotate().flatten({ background: "#fff" }).resize(900, 900, { fit: "inside", withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels as 3 | 4 };
}
const fromRaw = (r: Awaited<ReturnType<typeof raw>>) => sharp(r.data, { raw: { width: r.width, height: r.height, channels: r.channels } });
const kind = async (bytes: Uint8Array | Buffer) => (await classifySourceImage(bytes)).kind;

describe("source kind: the committed samples", () => {
  it("has samples of both kinds to test against", () => {
    expect(DRAWINGS.length).toBeGreaterThanOrEqual(8);
    expect(PHOTOS.length).toBeGreaterThanOrEqual(14);
  });

  it.each(DRAWINGS)("reads $name as a line drawing", async ({ path }) => {
    expect(await kind(load(path))).toBe("drawing");
  });

  it.each(PHOTOS)("reads $name as a photo", async ({ path }) => {
    expect(await kind(load(path))).toBe("photo");
  });
});

describe("source kind: how people really upload", () => {
  const drawing = () => raw(fixture("Test Elevation", "architectural elevation design.jpg"));
  const shaded = () => raw(fixture("Test Elevation", "w800x533.jpg")); // dense CAD hatching and grey fills
  const photo = () => raw(fixture("Rendered Results", "Exterior - Detailed (1).jpeg"));

  it("still sees a scanned, cream-tinted, noisy drawing as a drawing", async () => {
    for (const source of [await drawing(), await shaded()]) {
      const scan = await sharp(noisy(source.data, 8), { raw: { width: source.width, height: source.height, channels: source.channels } })
        .linear([0.98, 0.96, 0.89], [0, 0, 0]).jpeg({ quality: 45 }).toBuffer();
      expect(await kind(scan)).toBe("drawing");
    }
  });

  it("sees a drawing photographed on a wooden desk as a drawing", async () => {
    for (const source of [await drawing(), await shaded()]) {
      const onDesk = await fromRaw(source).extend({
        top: Math.round(source.height * 0.18), bottom: Math.round(source.height * 0.18),
        left: Math.round(source.width * 0.18), right: Math.round(source.width * 0.18),
        background: { r: 120, g: 84, b: 56 },
      }).jpeg().toBuffer();
      expect(await kind(onDesk)).toBe("drawing");
    }
  });

  it("sees a low-resolution, heavily compressed drawing as a drawing", async () => {
    const source = await shaded();
    const small = await fromRaw(source).resize(Math.round(source.width / 3)).jpeg({ quality: 30 }).toBuffer();
    expect(await kind(small)).toBe("drawing");
  });

  it("sees a photo with white margins as a photo", async () => {
    const source = await photo();
    const padded = await fromRaw(source).extend({
      top: Math.round(source.height * 0.25), bottom: Math.round(source.height * 0.25),
      left: Math.round(source.width * 0.25), right: Math.round(source.width * 0.25), background: "#fff",
    }).jpeg().toBuffer();
    expect(await kind(padded)).toBe("photo");
  });

  it("sees a letterboxed, washed-out, blurred or grayscale photo as a photo", async () => {
    const source = await photo();
    const variants = [
      await fromRaw(source).extend({ top: 120, bottom: 120, background: "#000" }).jpeg().toBuffer(),
      await fromRaw(source).linear(0.5, 110).jpeg().toBuffer(),
      await fromRaw(source).blur(6).jpeg().toBuffer(),
      await fromRaw(source).greyscale().jpeg().toBuffer(),
      await fromRaw(source).resize(Math.round(source.width / 2)).jpeg({ quality: 20 }).toBuffer(),
    ];
    for (const bytes of variants) expect(await kind(bytes)).toBe("photo");
  });
});

describe("source kind: the safe default", () => {
  it("treats a blank sheet and a tiny image as drawings, never as photos", async () => {
    const blank = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#fff" } }).png().toBuffer();
    const tiny = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#789" } }).png().toBuffer();
    expect(await kind(blank)).toBe("drawing");
    expect(await kind(tiny)).toBe("drawing");
  });

  it("treats a flat dark image as a drawing rather than guessing a photo", async () => {
    const dark = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#101018" } }).png().toBuffer();
    expect(await kind(dark)).toBe("drawing");
  });

  it("handles a transparent PNG drawing", async () => {
    const source = await raw(fixture("Test Elevation", "Original Lakeside house.png"));
    const png = await fromRaw(source).png().toBuffer();
    expect(await kind(png)).toBe("drawing");
  });
});

describe("source kind: threshold margins", () => {
  it("keeps clear daylight between the sample drawings and photographs", async () => {
    const drawings = await Promise.all(DRAWINGS.map(async (f) => (await classifySourceImage(load(f.path))).signals.dominantShare));
    const photos = await Promise.all(PHOTOS.map(async (f) => (await classifySourceImage(load(f.path))).signals.dominantShare));
    // Photographs sit well below the drawing-paper threshold; drawings well above the photo ceiling.
    expect(Math.max(...photos)).toBeLessThan(0.4);
    expect(Math.min(...drawings)).toBeGreaterThan(0.3);
  });
});
