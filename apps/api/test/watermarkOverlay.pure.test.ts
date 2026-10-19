import { createHash } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { watermarkImage } from "../src/lib/watermark.js";
import { overlaySvg, WATERMARK_GEOMETRY } from "../src/lib/watermarkOverlay.js";

// The watermark's grid, crosses, opacity and colour are a fixed design; only the mark artwork
// changes with the brand. These tests pin the layout so an artwork change can't move it.

const uses = (svg: string, id: "mark" | "cross") =>
  [...svg.matchAll(new RegExp(`<use xlink:href="#${id}" x="(-?[\\d.]+)" y="(-?[\\d.]+)"/>`, "g"))].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));

// The <defs> part (the artwork) removed, so the grid can be compared on its own.
const gridOnly = (svg: string) => svg.replace(/<defs>[\s\S]*<\/defs>/, "<defs/>");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

describe("watermark geometry", () => {
  it("keeps the approved constants", () => {
    expect(WATERMARK_GEOMETRY).toEqual({
      BASE_SIDE: 1536,
      COLUMN_STEP: 326,
      ROW_STEP: 179,
      FIRST_MARK: { x: 65, y: 56 },
      CROSS_ARM: { x: 70, y: 61 },
      CROSS_OFFSET: { x: -71, y: -63 },
      CROSS_DASH: "14 5",
      CROSS_STROKE_WIDTH: 1,
      MARK_OPACITY: 0.45,
      CROSS_OPACITY: 0.5,
    });
  });

  it("lays marks on an aligned grid from (65, 56), one row and column past the edges", () => {
    const marks = uses(overlaySvg(1536, 1024), "mark");
    // ceil(1536 / 326) + 1 columns, ceil(1024 / 179) + 1 rows.
    expect(marks).toHaveLength(6 * 7);
    expect(marks[0]).toEqual({ x: 65, y: 56 });
    for (const [i, mark] of marks.entries()) {
      expect(mark).toEqual({ x: 65 + (i % 6) * 326, y: 56 + Math.floor(i / 6) * 179 });
    }
  });

  it("puts a cross up and left of every mark", () => {
    const svg = overlaySvg(1536, 1024);
    const marks = uses(svg, "mark");
    const crosses = uses(svg, "cross");
    expect(crosses).toEqual(marks.map(({ x, y }) => ({ x: x - 71, y: y - 63 })));
  });

  it("draws the cross as a dashed X with arms of 70 x 61", () => {
    const cross = /<g id="cross">(.*?)<\/g>/.exec(overlaySvg(1536, 1024))![1];
    expect(cross).toBe('<path d="M-70 -61L70 61M70 -61L-70 61" stroke="#fff" stroke-width="1" stroke-dasharray="14 5"/>');
  });

  it("applies the opacities to the crosses and the marks", () => {
    const svg = overlaySvg(1536, 1024);
    expect(svg).toMatch(/<g opacity="0.5"><use xlink:href="#cross"/);
    expect(svg).toMatch(/<g opacity="0.45"><use xlink:href="#mark"/);
  });

  it("is white only, with no text or fonts", () => {
    const svg = overlaySvg(1536, 1024);
    expect(svg).not.toMatch(/<text|font-family|<image/);
    for (const [, colour] of svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)) expect(["#fff", "none"]).toContain(colour);
  });

  it("is the size of the image and scales by its long side", () => {
    for (const [w, h] of [[1536, 1024], [1024, 1536], [320, 200], [7680, 5120]] as const) {
      const svg = overlaySvg(w, h);
      expect(svg).toContain(`width="${w}" height="${h}"`);
      expect(svg).toContain(`scale(${Math.max(w, h) / 1536})`);
    }
    // Portrait and landscape share a scale, so the marks are the same size.
    expect(overlaySvg(1536, 1024)).toContain("scale(1)");
    expect(overlaySvg(1024, 1536)).toContain("scale(1)");
  });

  it("produces the same grid as the production design", () => {
    // Hashes of the grid (artwork removed) from the v2 overlay; an artwork change keeps them.
    expect(sha256(gridOnly(overlaySvg(1536, 1024)))).toBe(GRID_1536x1024);
    expect(sha256(gridOnly(overlaySvg(1024, 1536)))).toBe(GRID_1024x1536);
    expect(sha256(gridOnly(overlaySvg(7680, 5120)))).toBe(GRID_7680x5120);
  });
});

describe("watermarkImage", () => {
  const image = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "#7a8c99" } });

  it("keeps the size and format, and changes the pixels", async () => {
    const png = await image(320, 200).png().toBuffer();
    const out = await watermarkImage(new Uint8Array(png), "image/png");
    expect(await sharp(out).metadata()).toMatchObject({ width: 320, height: 200, format: "png" });
    expect(Buffer.compare(Buffer.from(out), png)).not.toBe(0);

    const jpeg = await image(320, 200).jpeg().toBuffer();
    expect(await sharp(await watermarkImage(new Uint8Array(jpeg), "image/jpeg")).metadata()).toMatchObject({ format: "jpeg" });
    const webp = await image(320, 200).webp().toBuffer();
    expect(await sharp(await watermarkImage(new Uint8Array(webp), "image/webp")).metadata()).toMatchObject({ format: "webp" });
  });

  it("rotates EXIF-rotated images upright before marking them", async () => {
    const rotated = await image(320, 200).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const out = await watermarkImage(new Uint8Array(rotated), "image/jpeg");
    expect(await sharp(out).metadata()).toMatchObject({ width: 200, height: 320 });
  });
});

const GRID_1536x1024 = "e14e6d9ef56410af0bc4457436ea2f249a9ef7d56e740a589ea262b06a66ec8f";
const GRID_1024x1536 = "aaaa992b271bbef41d7f6d8390307fe11eaecf91aca82d83d87094074de00544";
const GRID_7680x5120 = "c373a1a27004c9fc530834016bb41b14e293f70d1ef7bd41fbc59c984c1a11c7";
