// Local, free structural + palette metrics. No model calls.
//
// IMPORTANT: these are SIGNALS for ranking approaches against each other on the same inputs, not a
// pass/fail proof. A line drawing and a photoreal render do not share pixels; the human rubric in
// report.html remains the authority for roof / openings / proportions.
import { createRequire } from "node:module";

const require = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const sharp = require("sharp");

const WIDTH = 512;
const EDGE_QUANTILE = 0.92; // keep the strongest 8% of result gradients
const TOLERANCE_PX = 6; // ~1.2% of width: how far a result edge may sit from a source line
const LINE_DARKNESS = 150; // source pixels darker than this count as drawn lines
const BBOX_MARGIN = 0.03;

async function gray(input, width, height, { blur = 0 } = {}) {
  let image = sharp(input).rotate().flatten({ background: "#ffffff" }).resize(width, height, { fit: "fill" }).grayscale();
  if (blur) image = image.blur(blur);
  const { data } = await image.raw().toBuffer({ resolveWithObject: true });
  return data;
}

function sobelMagnitude(g, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
      const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
      out[i] = Math.hypot(gx, gy);
    }
  }
  return out;
}

function quantile(values, q) {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function dilate(mask, w, h, r) {
  const horizontal = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r) && !hit; k++) hit = mask[y * w + k];
      horizontal[y * w + x] = hit;
    }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let hit = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r) && !hit; k++) hit = horizontal[k * w + x];
      out[y * w + x] = hit;
    }
  }
  return out;
}

function flipHorizontal(mask, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = mask[y * w + (w - 1 - x)];
  return out;
}

function score(sourceLines, sourceDilated, resultEdges, resultDilated, w, h, bbox) {
  let lines = 0;
  let linesFound = 0;
  let edges = 0;
  let edgesExplained = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (sourceLines[i]) {
        lines++;
        if (resultDilated[i]) linesFound++;
      }
      if (resultEdges[i] && x >= bbox.x0 && x <= bbox.x1 && y >= bbox.y0 && y <= bbox.y1) {
        edges++;
        if (sourceDilated[i]) edgesExplained++;
      }
    }
  }
  const recall = lines ? linesFound / lines : 0;
  const precision = edges ? edgesExplained / edges : 0;
  const f1 = recall + precision ? (2 * recall * precision) / (recall + precision) : 0;
  return { recall, precision, f1 };
}

/**
 * Structural agreement between a source drawing and a render.
 *  - recall    : share of the source's drawn lines that have a strong render edge nearby
 *                (did the drawn structure survive?)
 *  - precision : share of strong render edges, inside the building's bounding box, that sit near a
 *                source line (was structure added that the drawing never had?)
 *  - lift      : f1 minus the same f1 against a mirror-flipped render. Mirroring keeps texture
 *                statistics but destroys layout, so lift is the signal above the noise floor.
 */
export async function structuralDrift(sourcePath, resultPath) {
  const meta = await sharp(sourcePath).rotate().metadata();
  const resultMeta = await sharp(resultPath).rotate().metadata();
  const h = Math.round((WIDTH * meta.height) / meta.width);
  const aspectMismatch = Math.abs(meta.width / meta.height - resultMeta.width / resultMeta.height) / (meta.width / meta.height);

  const src = await gray(sourcePath, WIDTH, h);
  const res = await gray(resultPath, WIDTH, h, { blur: 1.2 });

  const sourceLines = new Uint8Array(WIDTH * h);
  let x0 = WIDTH, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (src[y * WIDTH + x] < LINE_DARKNESS) {
        sourceLines[y * WIDTH + x] = 1;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
  }
  const mx = Math.round(WIDTH * BBOX_MARGIN);
  const my = Math.round(h * BBOX_MARGIN);
  const bbox = { x0: Math.max(0, x0 - mx), x1: Math.min(WIDTH - 1, x1 + mx), y0: Math.max(0, y0 - my), y1: Math.min(h - 1, y1 + my) };

  const magnitude = sobelMagnitude(res, WIDTH, h);
  const cutoff = quantile(magnitude, EDGE_QUANTILE);
  const resultEdges = new Uint8Array(WIDTH * h);
  for (let i = 0; i < magnitude.length; i++) resultEdges[i] = magnitude[i] >= cutoff ? 1 : 0;

  const sourceDilated = dilate(sourceLines, WIDTH, h, TOLERANCE_PX);
  const resultDilated = dilate(resultEdges, WIDTH, h, TOLERANCE_PX);
  const real = score(sourceLines, sourceDilated, resultEdges, resultDilated, WIDTH, h, bbox);

  const flippedEdges = flipHorizontal(resultEdges, WIDTH, h);
  const flippedDilated = dilate(flippedEdges, WIDTH, h, TOLERANCE_PX);
  const nullScore = score(sourceLines, sourceDilated, flippedEdges, flippedDilated, WIDTH, h, bbox);

  return {
    recall: round(real.recall),
    precision: round(real.precision),
    f1: round(real.f1),
    nullF1: round(nullScore.f1),
    lift: round(real.f1 - nullScore.f1),
    aspectMismatch: round(aspectMismatch),
  };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let hue;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  return [(hue * 60 + 360) % 360, s, l];
}

async function paletteHistogram(path) {
  const { data, info } = await sharp(path).rotate().flatten({ background: "#ffffff" }).resize(128, 128, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const bins = new Float64Array(5 + 12 * 3);
  let total = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const [hue, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    // The reference's landscape and sky must not count as building finish.
    if (hue >= 70 && hue <= 170 && s > 0.2) continue;
    if (hue >= 185 && hue <= 250 && s > 0.15 && l > 0.45) continue;
    if (s < 0.12) bins[Math.min(4, Math.floor(l * 5))]++;
    else bins[5 + Math.floor(hue / 30) * 3 + Math.min(2, Math.floor(l * 3))]++;
    total++;
  }
  return total ? bins.map((v) => v / total) : bins;
}

/** Histogram intersection of building-ish colours (nature/sky excluded), 0..1. Auxiliary only. */
export async function paletteMatch(referencePath, resultPath) {
  const [a, b] = await Promise.all([paletteHistogram(referencePath), paletteHistogram(resultPath)]);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.min(a[i], b[i]);
  return round(sum);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * Share of pixels that are "filled" (not near-white paper). A photoreal render is ~1.0; an output
 * that is still a line drawing with white walls sits far lower. Used to stop structural scores
 * from rewarding a model that simply handed the drawing back (round 1's approach C did exactly that).
 */
export async function photoCoverage(resultPath) {
  const { data, info } = await sharp(resultPath).rotate().flatten({ background: "#ffffff" }).resize(128, 128, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let filled = 0;
  const pixels = data.length / info.channels;
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (luma < 215 || Math.max(r, g, b) - Math.min(r, g, b) > 25) filled++;
  }
  return round(filled / pixels);
}

// ---------- measured colour (deterministic; no model) ----------
function srgbToLab(r, g, b) {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const hex2 = (n) => Math.round(n).toString(16).padStart(2, "0");

/** Dominant building-ish colours (vegetation and sky excluded), by k-means in Lab. */
export async function dominantColours(path, k = 5) {
  const { data, info } = await sharp(path).rotate().flatten({ background: "#ffffff" }).resize(96, 96, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pts = [];
  for (let i = 0; i < data.length; i += info.channels) {
    const [hue, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (hue >= 70 && hue <= 170 && s > 0.2) continue;
    if (hue >= 185 && hue <= 250 && s > 0.15 && l > 0.45) continue;
    pts.push({ rgb: [data[i], data[i + 1], data[i + 2]], lab: srgbToLab(data[i], data[i + 1], data[i + 2]) });
  }
  if (pts.length < k) return [];
  const sorted = [...pts].sort((a, b) => a.lab[0] - b.lab[0]);
  let centres = Array.from({ length: k }, (_, i) => sorted[Math.floor(((i + 0.5) / k) * sorted.length)].lab.slice());
  let assign = new Array(pts.length).fill(0);
  for (let iter = 0; iter < 12; iter++) {
    pts.forEach((p, i) => {
      let best = 0, bd = Infinity;
      centres.forEach((c, j) => { const d = (p.lab[0] - c[0]) ** 2 + (p.lab[1] - c[1]) ** 2 + (p.lab[2] - c[2]) ** 2; if (d < bd) { bd = d; best = j; } });
      assign[i] = best;
    });
    centres = centres.map((c, j) => {
      const m = pts.filter((_, i) => assign[i] === j);
      return m.length ? [0, 1, 2].map((a) => m.reduce((s, p) => s + p.lab[a], 0) / m.length) : c;
    });
  }
  return centres
    .map((lab, j) => {
      const m = pts.filter((_, i) => assign[i] === j);
      const rgb = [0, 1, 2].map((a) => m.reduce((s, p) => s + p.rgb[a], 0) / Math.max(1, m.length));
      return { lab, weight: m.length / pts.length, hex: `#${rgb.map(hex2).join("")}` };
    })
    .filter((c) => c.weight > 0.04)
    .sort((a, b) => b.weight - a.weight);
}

/**
 * How well a render's colours cover the reference's main building colours: the weighted mean, over the
 * reference's top-3 clusters, of the distance (CIE76 delta-E) to the nearest cluster in the render.
 * Lower is better; < ~15 reads as the same colour family. Also reports the render's warmest large
 * neutral so a white-to-cream drift shows up as a positive `warmNeutralB`.
 */
export async function colourAccuracy(referencePath, resultPath) {
  const [ref, res] = await Promise.all([dominantColours(referencePath), dominantColours(resultPath, 6)]);
  const top = ref.slice(0, 3);
  const total = top.reduce((s, c) => s + c.weight, 0) || 1;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const deltaE = top.reduce((sum, c) => sum + (c.weight / total) * Math.min(...res.map((r) => dist(c.lab, r.lab))), 0);
  const bright = res.filter((c) => c.lab[0] > 75).sort((a, b) => b.weight - a.weight)[0];
  return { deltaE: round(deltaE), warmNeutralB: bright ? round(bright.lab[2]) : null, referenceHexes: ref.slice(0, 4).map((c) => c.hex), resultHexes: res.slice(0, 4).map((c) => c.hex) };
}

// ---------- CIEDE2000 and masked wall colour ----------
export function ciede2000([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (b, a) => { const v = Math.atan2(b, a) / rad; return v >= 0 ? v : v + 360; };
  const h1p = C1p === 0 ? 0 : h(b1, a1p), h2p = C2p === 0 ? 0 : h(b2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2);
  const Lbar = (L1 + L2) / 2, Cbarp = (C1p + C2p) / 2;
  let hbar = h1p + h2p;
  if (C1p * C2p !== 0) { hbar = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + (h1p + h2p < 360 ? 360 : -360)) / 2 : (h1p + h2p) / 2; }
  const T = 1 - 0.17 * Math.cos((hbar - 30) * rad) + 0.24 * Math.cos(2 * hbar * rad) + 0.32 * Math.cos((3 * hbar + 6) * rad) - 0.2 * Math.cos((4 * hbar - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbar - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
  const Sc = 1 + 0.045 * Cbarp, Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

/**
 * Colour of the masked wall region, normalised for lighting: only the lit half of the masked pixels is used
 * (shadows are not paint colour), pixels darker than L*20 are ignored, and the median Lab is returned.
 */
export async function maskedWallColour(imagePath, maskBytes) {
  const W = 512;
  const meta = await sharp(imagePath).rotate().metadata();
  const H = Math.round((W * meta.height) / meta.width);
  const rgb = await sharp(imagePath).rotate().flatten({ background: "#fff" }).resize(W, H, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const mask = await sharp(maskBytes).resize(W, H, { fit: "fill" }).greyscale().raw().toBuffer();
  const px = [];
  for (let i = 0; i < W * H; i++) {
    if (mask[i] < 128) continue;
    const lab = srgbToLab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
    if (lab[0] >= 20) px.push(lab);
  }
  if (px.length < 400) return null;
  const sortedL = px.map((p) => p[0]).sort((a, b) => a - b);
  const cut = sortedL[Math.floor(sortedL.length * 0.4)];
  const lit = px.filter((p) => p[0] >= cut);
  const med = (k) => { const v = lit.map((p) => p[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  return { lab: [med(0), med(1), med(2)], pixels: px.length, maskShare: round(px.length / (W * H)) };
}

/** Compare a render's wall colour with the reference's: full dE00, chromatic-only dE00 (lightness equalised), and b* shift (cream = positive). */
export function wallColourDelta(reference, render) {
  if (!reference || !render) return null;
  const chromatic = [reference.lab[0], render.lab[1], render.lab[2]];
  return {
    deltaE00: round(ciede2000(reference.lab, render.lab)),
    chromaticDeltaE00: round(ciede2000(reference.lab, chromatic)),
    bShift: round(render.lab[2] - reference.lab[2]),
    referenceLab: reference.lab.map(round),
    renderLab: render.lab.map(round),
  };
}
