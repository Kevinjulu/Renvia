// Shape-free swatch boards built from the ACTUAL reference image (Phase 4).
//
// A swatch board gives the renderer pixels for colour and texture without giving it another building:
//   - each tile is a small crop of a single surface, chosen where the reference is homogeneous (low edge energy,
//     no strong edge inside the crop), so it contains texture but no recognisable geometry;
//   - beneath the crop sits a solid chip of that crop's MEASURED mean colour (pixels, not a model's guess);
//   - when no clean crop exists (thin window frames, for example) the tile is a chip only, using the analysis colour.
// Labels name the surface each tile is for (variant SW2/SW3) and are drawn as vector paths so no system font is needed.
import { createRequire } from "node:module";

const require = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const sharp = require("sharp");

const ROLE_ORDER = ["walls_primary", "walls_secondary", "cladding", "base_plinth", "window_frames", "doors", "soffit_fascia", "paving"];
export const ROLE_LABEL = {
  walls_primary: "WALLS",
  walls_secondary: "SECOND WALLS",
  cladding: "CLADDING",
  base_plinth: "BASE",
  window_frames: "WINDOW FRAMES",
  doors: "DOORS",
  soffit_fascia: "SOFFIT",
  paving: "PAVING",
};

const WORK_WIDTH = 1000; // working copy width (never upscaled)
const WIN = 36; // crop size on the working copy
const STEP = 6;
// A crop must be a patch of ONE surface: no strong edge at all, low mean gradient, low colour spread. Anything with an
// object fragment (plant, fixture, door edge) fails these tests and the role falls back to a solid chip.
const EDGE_MEAN_MAX = 14;
const STRONG_EDGE = 70;
const MAX_DELTA_E = 14; // crop colour must be close to the analysed colour for its role
const L_SPREAD_MAX = { walls_primary: 6, walls_secondary: 7, soffit_fascia: 7, base_plinth: 9, paving: 10, cladding: 14, doors: 14, window_frames: 8 };
const AB_SPREAD_MAX = 8;
const DUPLICATE_CHIP_DELTA_E = 7; // a second role whose chip matches an earlier one adds nothing

function hexToRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
const toHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

function srgbToLab([r, g, b]) {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Finds the cleanest crop of `targetHex` in the reference, or null. */
async function findPatch(workRaw, w, h, targetHex, role) {
  const target = srgbToLab(hexToRgb(targetHex));
  const luma = new Float32Array(w * h);
  const lab = new Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const rgb = [workRaw[i * 3], workRaw[i * 3 + 1], workRaw[i * 3 + 2]];
    luma[i] = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    lab[i] = srgbToLab(rgb);
  }
  const grad = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = luma[i + 1] - luma[i - 1];
      const gy = luma[i + w] - luma[i - w];
      grad[i] = Math.hypot(gx, gy);
    }
  }
  let best = null;
  for (let y = 0; y + WIN <= h; y += STEP) {
    for (let x = 0; x + WIN <= w; x += STEP) {
      let gsum = 0, strong = 0, nature = 0;
      const mean = [0, 0, 0];
      const sq = [0, 0, 0];
      const rgbMean = [0, 0, 0];
      for (let yy = y; yy < y + WIN; yy++) {
        for (let xx = x; xx < x + WIN; xx++) {
          const i = yy * w + xx;
          gsum += grad[i];
          if (grad[i] > STRONG_EDGE) strong++;
          const [L, a, b] = lab[i];
          mean[0] += L; mean[1] += a; mean[2] += b;
          sq[0] += L * L; sq[1] += a * a; sq[2] += b * b;
          for (let c = 0; c < 3; c++) rgbMean[c] += workRaw[i * 3 + c];
          // vegetation / sky pixels must not become a "material"
          if (a < -14 && b > 8) nature++;
          if (b < -12 && L > 45) nature++;
        }
      }
      const n = WIN * WIN;
      const meanGrad = gsum / n;
      const m = mean.map((v) => v / n);
      const sd = sq.map((v, k) => Math.sqrt(Math.max(0, v / n - m[k] * m[k])));
      if (meanGrad > EDGE_MEAN_MAX || strong > 0 || nature / n > 0.02) continue;
      if (sd[0] > (L_SPREAD_MAX[role] ?? 8) || sd[1] > AB_SPREAD_MAX || sd[2] > AB_SPREAD_MAX) continue;
      const dE = dist(m, target);
      if (dE > MAX_DELTA_E) continue;
      const score = dE + 0.35 * meanGrad;
      if (!best || score < best.score) best = { x, y, score, dE, meanGrad, rgb: rgbMean.map((v) => v / n) };
    }
  }
  return best;
}

// Minimal vector glyphs (uppercase, digits unused) so labels never depend on installed fonts.
const GLYPHS = {
  A: "M0 10 L4 0 L8 10 M1.6 6.5 L6.4 6.5", B: "M0 0 L0 10 L5 10 Q8 10 8 7.5 Q8 5 5 5 L0 5 M0 0 L5 0 Q7.5 0 7.5 2.5 Q7.5 5 5 5",
  C: "M8 2 Q6 0 4 0 Q0 0 0 5 Q0 10 4 10 Q6 10 8 8", D: "M0 0 L0 10 L4 10 Q8 10 8 5 Q8 0 4 0 L0 0", E: "M8 0 L0 0 L0 10 L8 10 M0 5 L6 5",
  F: "M8 0 L0 0 L0 10 M0 5 L6 5", G: "M8 2 Q6 0 4 0 Q0 0 0 5 Q0 10 4 10 Q8 10 8 6 L5 6", H: "M0 0 L0 10 M8 0 L8 10 M0 5 L8 5",
  I: "M2 0 L2 10 M0 0 L4 0 M0 10 L4 10", L: "M0 0 L0 10 L7 10", M: "M0 10 L0 0 L4 6 L8 0 L8 10", N: "M0 10 L0 0 L8 10 L8 0",
  O: "M4 0 Q0 0 0 5 Q0 10 4 10 Q8 10 8 5 Q8 0 4 0", P: "M0 10 L0 0 L5 0 Q8 0 8 3 Q8 6 5 6 L0 6", R: "M0 10 L0 0 L5 0 Q8 0 8 3 Q8 6 5 6 L0 6 M4 6 L8 10",
  S: "M8 1.5 Q6 0 4 0 Q0 0 0 2.5 Q0 5 4 5 Q8 5 8 7.5 Q8 10 4 10 Q2 10 0 8.5", T: "M0 0 L8 0 M4 0 L4 10", U: "M0 0 L0 7 Q0 10 4 10 Q8 10 8 7 L8 0",
  W: "M0 0 L2 10 L4 4 L6 10 L8 0", Y: "M0 0 L4 5 L8 0 M4 5 L4 10", K: "M0 0 L0 10 M8 0 L0 6 M3 5 L8 10", V: "M0 0 L4 10 L8 0", X: "M0 0 L8 10 M8 0 L0 10", Z: "M0 0 L8 0 L0 10 L8 10",
};
function labelPath(text, x, y, scale) {
  let cursor = x;
  const parts = [];
  for (const ch of text) {
    if (ch === " ") { cursor += 6 * scale; continue; }
    const d = GLYPHS[ch];
    if (!d) continue;
    parts.push(`<path d="${d}" transform="translate(${cursor} ${y}) scale(${scale})" fill="none" stroke="#111" stroke-width="${1.5}" stroke-linecap="round" stroke-linejoin="round"/>`);
    cursor += 11 * scale;
  }
  return { svg: parts.join(""), width: cursor - x };
}

/**
 * @returns {{png: Buffer, tiles: object[]}}
 */
export async function buildSwatchBoard(referencePath, materials, { labels }) {
  const meta = await sharp(referencePath).rotate().metadata();
  const w = Math.min(WORK_WIDTH, meta.width);
  const h = Math.round((w * meta.height) / meta.width);
  const work = await sharp(referencePath).rotate().flatten({ background: "#fff" }).resize(w, h).removeAlpha().raw().toBuffer();

  const surfaces = [];
  for (const role of ROLE_ORDER) {
    const s = materials.surfaces.find((x) => x.surface === role && x.confidence !== "low" && x.colour.hex);
    if (s && !surfaces.some((x) => x.surface === role)) surfaces.push(s);
  }
  const chosen = surfaces;

  const tiles = [];
  for (const s of chosen) {
    const patch = await findPatch(work, w, h, s.colour.hex, s.surface);
    const chipHex = patch ? toHex(patch.rgb) : s.colour.hex;
    const chipLab = srgbToLab(hexToRgb(chipHex));
    if (tiles.some((t) => dist(srgbToLab(hexToRgb(t.chipHex)), chipLab) < DUPLICATE_CHIP_DELTA_E)) continue;
    tiles.push({
      role: s.surface,
      label: ROLE_LABEL[s.surface],
      analysedHex: s.colour.hex,
      patch: patch ? { x: patch.x, y: patch.y, size: WIN, deltaE: +patch.dE.toFixed(1), edgeEnergy: +patch.meanGrad.toFixed(1) } : null,
      chipHex,
      chipSource: patch ? "measured from crop" : "analysis colour (no clean crop)",
      crop: patch ? await sharp(work, { raw: { width: w, height: h, channels: 3 } }).extract({ left: patch.x, top: patch.y, width: WIN, height: WIN }).resize(240, 150, { kernel: "lanczos3" }).png().toBuffer() : null,
    });
  }

  tiles.splice(6); // at most six tiles
  const TILE_W = 240, TILE_H = 150, CHIP_H = 56, LABEL_H = labels ? 34 : 0, GAP = 14, COLS = 3;
  const rows = Math.ceil(tiles.length / COLS);
  const cellH = TILE_H + CHIP_H + LABEL_H;
  const boardW = COLS * TILE_W + (COLS + 1) * GAP;
  const boardH = rows * cellH + (rows + 1) * GAP;
  const layers = [];
  const svgParts = [];
  tiles.forEach((t, i) => {
    const left = GAP + (i % COLS) * (TILE_W + GAP);
    const top = GAP + Math.floor(i / COLS) * (cellH + GAP);
    const chipRgb = hexToRgb(t.chipHex);
    if (t.crop) layers.push({ input: t.crop, left, top });
    else svgParts.push(`<rect x="${left}" y="${top}" width="${TILE_W}" height="${TILE_H}" fill="${t.chipHex}"/>`);
    svgParts.push(`<rect x="${left}" y="${top + TILE_H}" width="${TILE_W}" height="${CHIP_H}" fill="rgb(${chipRgb.join(",")})"/>`);
    if (labels) {
      svgParts.push(`<rect x="${left}" y="${top + TILE_H + CHIP_H}" width="${TILE_W}" height="${LABEL_H}" fill="#ffffff"/>`);
      const { svg, width } = labelPath(t.label, 0, 0, 1.25);
      const x = left + Math.max(6, (TILE_W - width) / 2);
      svgParts.push(`<g transform="translate(${x} ${top + TILE_H + CHIP_H + 10})">${svg}</g>`);
    }
  });
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${boardW}" height="${boardH}">${svgParts.join("")}</svg>`);
  const png = await sharp({ create: { width: boardW, height: boardH, channels: 3, background: "#eeeeee" } })
    .composite([{ input: overlay, left: 0, top: 0 }, ...layers])
    .png()
    .toBuffer();
  return { png, tiles: tiles.map(({ crop, ...rest }) => rest), width: boardW, height: boardH };
}
