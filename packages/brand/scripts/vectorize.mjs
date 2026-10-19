/**
 * Rebuilds src/logoPaths.js from the owner's reference artwork:
 * source/ramah-studio-international-logo.png (1536 x 1024, flattened, no vector original).
 *
 * The artwork's typefaces are not available as fonts (no open-licence face matched closely), so
 * the logo is reconstructed from the image itself: sub-pixel contours of the anti-aliased edges,
 * corners kept sharp, curves fitted within 0.35px (see trace.mjs). This is a reconstruction, not
 * the original vector file; the fidelity it achieves is measured and written next to the paths.
 *
 *   pnpm --filter @renvia/brand vectorize
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { area, contours, loopToPath } from "./trace.mjs";

const SOURCE = fileURLToPath(new URL("../source/ramah-studio-international-logo.png", import.meta.url));
const OUTPUT = new URL("../src/logoPaths.js", import.meta.url);
const WATERMARK_OUTPUT = new URL("../src/watermarkPaths.js", import.meta.url);

const { data, info } = await sharp(SOURCE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const clamp = (v) => Math.max(0, Math.min(1, v));

/**
 * Ink coverage (0..1) of one colour inside a box. Gold is told apart by its chroma (red minus
 * blue); black is a dark red channel with any gold taken out. The two never touch: the artwork
 * separates them with white gaps.
 */
function coverage(colour, [x0, y0, x1, y1]) {
  const w = x1 - x0, h = y1 - y0, field = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((y + y0) * info.width + x + x0) * 3, red = data[i], blue = data[i + 2];
    const gold = clamp((red - blue) / 119);
    field[y * w + x] = colour === "gold" ? gold : clamp((255 - red) / 239 - 1.5 * gold);
  }
  return { field, w, h };
}

// Each part of the logo, the colour it is drawn in, and the box it sits in on the reference.
const PARTS = {
  symbolInk: { colour: "black", box: [360, 140, 1180, 592] }, // the R
  symbolGold: { colour: "gold", box: [360, 140, 1180, 592] }, // the S, globe and orbit
  name: { colour: "black", box: [130, 608, 1410, 750] }, // RAMAH STUDIO
  subtitle: { colour: "black", box: [130, 752, 1410, 882] }, // international
};
const MIN_AREA = 3; // px²: specks smaller than this are compression noise, not artwork

const paths = {}, bounds = {}, fidelity = {};
for (const [name, { colour, box }] of Object.entries(PARTS)) {
  const { field, w, h } = coverage(colour, box);
  const loops = contours(field, w, h).filter((loop) => Math.abs(area(loop)) >= MIN_AREA);
  // Paths are in the reference's own pixel coordinates, so the parts keep their placement.
  const d = loops.map((loop) => loopToPath(loop, { offset: [-box[0], -box[1]], dp: 1 })).join("");
  paths[name] = d;
  const xs = loops.flat().map((p) => p[0] + box[0]), ys = loops.flat().map((p) => p[1] + box[1]);
  bounds[name] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => Math.round(v * 10) / 10);

  // Fidelity: rasterise the paths and compare with the source's own coverage.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#fff"/><path transform="translate(${-box[0]} ${-box[1]})" fill="#000" fill-rule="evenodd" d="${d}"/></svg>`;
  const raster = (await sharp(Buffer.from(svg)).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true })).data;
  let both = 0, either = 0, differ = 0;
  for (let i = 0; i < field.length; i++) {
    const a = field[i] >= 0.5, b = raster[i] < 128;
    if (a && b) both++; if (a || b) either++; if (a !== b) differ++;
  }
  const perimeter = loops.reduce((sum, loop) => sum + loop.reduce((s, p, i) => s + Math.hypot(p[0] - loop[(i + 1) % loop.length][0], p[1] - loop[(i + 1) % loop.length][1]), 0), 0);
  fidelity[name] = { shapes: loops.length, iou: +(both / either).toFixed(3), meanEdgeErrorPx: +(differ / perimeter).toFixed(2) };
}

/**
 * The watermark cut. The watermark draws the logo about a tenth of its reference size, at 0.45
 * opacity, where the serif hairlines would fall below a pixel. So the cut is the same artwork
 * made bolder by a fixed amount on every edge, baked into the geometry (no runtime stroke: that
 * more than doubles the time to mark an 8K image), and the symbol is cropped to the R and S so
 * the orbit doesn't widen the unit. GROW is in reference px: 0.3 and 0.2 watermark px at the
 * scales watermark.js draws them, i.e. hairlines about 0.6 and 0.4 px heavier.
 */
const WATERMARK_CUT = {
  symbol: { parts: ["symbolInk", "symbolGold"], grow: 1.9, clip: [463, 140, 1058, 590] },
  name: { parts: ["name", "subtitle"], grow: 3.2, clip: null },
};
const SCALE = 2; // traced at twice the reference resolution

const watermarkPaths = {}, watermarkBounds = {};
for (const [name, { parts, grow, clip }] of Object.entries(WATERMARK_CUT)) {
  const d = parts.map((part) => paths[part]).join("");
  const xs = parts.flatMap((part) => [bounds[part][0], bounds[part][2]]), ys = parts.flatMap((part) => [bounds[part][1], bounds[part][3]]);
  const pad = grow + 2;
  const x0 = Math.floor((clip ? Math.max(clip[0], Math.min(...xs)) : Math.min(...xs)) - pad), y0 = Math.floor(Math.min(...ys) - pad);
  const x1 = Math.ceil((clip ? Math.min(clip[2], Math.max(...xs)) : Math.max(...xs)) + pad), y1 = Math.ceil(Math.max(...ys) + pad);
  const w = (x1 - x0) * SCALE, h = (y1 - y0) * SCALE;
  const clipDef = clip ? `<clipPath id="c"><rect x="${clip[0]}" y="${clip[1]}" width="${clip[2] - clip[0]}" height="${clip[3] - clip[1]}"/></clipPath>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#fff"/><g transform="scale(${SCALE}) translate(${-x0} ${-y0})">${clipDef}<path ${clip ? 'clip-path="url(#c)" ' : ""}fill="#000" fill-rule="evenodd" stroke="#000" stroke-width="${grow * 2}" stroke-linejoin="round" d="${d}"/></g></svg>`;
  const raster = (await sharp(Buffer.from(svg)).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true })).data;
  const field = Float32Array.from(raster, (v) => 1 - v / 255);
  const loops = contours(field, w, h).filter((loop) => Math.abs(area(loop)) >= MIN_AREA * SCALE * SCALE);
  // Drawn at about a tenth of reference size, so 0.5 reference px (err 1 at 2x) is ample.
  watermarkPaths[name] = loops.map((loop) => loopToPath(loop, { err: 1, offset: [-x0 * SCALE, -y0 * SCALE], scale: 1 / SCALE, dp: 1 })).join("");
  const lx = loops.flat().map((p) => p[0] / SCALE + x0), ly = loops.flat().map((p) => p[1] / SCALE + y0);
  watermarkBounds[name] = [Math.min(...lx), Math.min(...ly), Math.max(...lx), Math.max(...ly)].map((v) => Math.round(v * 10) / 10);
}

const banner = `// Generated by scripts/vectorize.mjs from source/ramah-studio-international-logo.png. Do not edit.
// Coordinates are pixels of the 1536 x 1024 reference artwork. Fill with fill-rule="evenodd".`;
const block = (o) => Object.entries(o).map(([k, d]) => `  ${k}: "${d}",`).join("\n");
fs.writeFileSync(
  OUTPUT,
  `${banner}

/** Bounding box of each part on the reference: [x0, y0, x1, y1]. */
export const logoBounds = ${JSON.stringify(bounds)};

/** How closely each part matches the reference (overlap, and mean edge error in reference px). */
export const logoFidelity = ${JSON.stringify(fidelity)};

export const logoPaths = {
${block(paths)}
};
`,
);
// Kept apart from the logo so the apps' bundles never include it; only the API draws watermarks.
fs.writeFileSync(
  WATERMARK_OUTPUT,
  `${banner}

/** Bounding box of each watermark-cut part, in reference px. */
export const watermarkBounds = ${JSON.stringify(watermarkBounds)};

/** The watermark cut: bolder by a fixed amount, symbol cropped to the R and S (see vectorize.mjs). */
export const watermarkPaths = {
${block(watermarkPaths)}
};
`,
);
console.table(fidelity);
console.log(bounds, watermarkBounds);
