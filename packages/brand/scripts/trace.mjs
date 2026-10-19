// Sub-pixel vectorizer: iso-contours of an anti-aliased coverage field (marching squares),
// corner detection, then least-squares cubic Bezier fitting (Schneider) between corners.

/** Closed contours of field f (w x h, values 0..1) at `level`, in pixel coordinates. */
export function contours(f, w, h, level = 0.5) {
  const v = (x, y) => (x <= 0 || y <= 0 || x > w || y > h ? 0 : f[(y - 1) * w + (x - 1)]);
  const point = (id) => {
    const [t, xs, ys] = id.split(","); const x = +xs, y = +ys;
    if (t === "h") { const a = v(x, y), b = v(x + 1, y); return [x + (level - a) / (b - a) - 0.5, y - 0.5]; }
    const a = v(x, y), b = v(x, y + 1); return [x - 0.5, y + (level - a) / (b - a) - 0.5];
  };
  const adj = new Map();
  const link = (a, b) => { (adj.get(a) ?? adj.set(a, []).get(a)).push(b); (adj.get(b) ?? adj.set(b, []).get(b)).push(a); };
  for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) {
    const tl = v(x, y) >= level, tr = v(x + 1, y) >= level, br = v(x + 1, y + 1) >= level, bl = v(x, y + 1) >= level;
    const c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
    if (c === 0 || c === 15) continue;
    const T = `h,${x},${y}`, B = `h,${x},${y + 1}`, L = `v,${x},${y}`, R = `v,${x + 1},${y}`;
    const centre = (v(x, y) + v(x + 1, y) + v(x + 1, y + 1) + v(x, y + 1)) / 4 >= level;
    switch (c) {
      case 1: case 14: link(L, B); break;
      case 2: case 13: link(B, R); break;
      case 3: case 12: link(L, R); break;
      case 4: case 11: link(T, R); break;
      case 6: case 9: link(T, B); break;
      case 7: case 8: link(L, T); break;
      case 5: if (centre) { link(L, T); link(B, R); } else { link(L, B); link(T, R); } break;
      case 10: if (centre) { link(T, R); link(L, B); } else { link(L, T); link(B, R); } break;
    }
  }
  const seen = new Set(), loops = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop = []; let prev = null, cur = start;
    while (cur && !seen.has(cur)) {
      seen.add(cur); loop.push(point(cur));
      const n = adj.get(cur); const next = n[0] !== prev ? n[0] : n[1]; prev = cur; cur = next;
    }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}

export const area = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return a / 2; };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], add = (a, b) => [a[0] + b[0], a[1] + b[1]], mul = (a, s) => [a[0] * s, a[1] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1], len = (a) => Math.hypot(a[0], a[1]), norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };

/** Indices of corners: points where the direction turns by more than `angle` degrees over ~k points. */
export function corners(p, k = 3, angle = 38) {
  const n = p.length, turn = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = sub(p[i], p[(i - k + n) % n]), b = sub(p[(i + k) % n], p[i]);
    turn[i] = Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))) * 180 / Math.PI;
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    if (turn[i] < angle) continue;
    let max = true; for (let d = -k; d <= k; d++) if (d && turn[(i + d + n) % n] > turn[i]) max = false;
    if (max && !out.some((j) => Math.min(Math.abs(j - i), n - Math.abs(j - i)) < k)) out.push(i);
  }
  return out.sort((a, b) => a - b);
}

/** Light smoothing that leaves corners (and their neighbours) alone. */
export function smooth(p, fixed, passes = 2) {
  let q = p.map((x) => x.slice()); const n = p.length; const keep = new Set(fixed);
  for (let s = 0; s < passes; s++) q = q.map((pt, i) => (keep.has(i) ? pt : mul(add(add(q[(i - 1 + n) % n], q[(i + 1) % n]), mul(pt, 2)), 0.25)));
  return q;
}

// Schneider, "An Algorithm for Automatically Fitting Digitized Curves" (Graphics Gems, 1990).
function bez(c, t) { const mt = 1 - t; return add(add(mul(c[0], mt * mt * mt), mul(c[1], 3 * mt * mt * t)), add(mul(c[2], 3 * mt * t * t), mul(c[3], t * t * t))); }
function bezD(c, t) { const mt = 1 - t; return add(add(mul(sub(c[1], c[0]), 3 * mt * mt), mul(sub(c[2], c[1]), 6 * mt * t)), mul(sub(c[3], c[2]), 3 * t * t)); }
function bezDD(c, t) { return add(mul(add(sub(c[2], mul(c[1], 2)), c[0]), 6 * (1 - t)), mul(add(sub(c[3], mul(c[2], 2)), c[1]), 6 * t)); }
function chordParams(pts) { const u = [0]; for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + len(sub(pts[i], pts[i - 1]))); const L = u[u.length - 1] || 1; return u.map((x) => x / L); }
function generate(pts, u, t1, t2) {
  const first = pts[0], last = pts[pts.length - 1];
  const C = [[0, 0], [0, 0]], X = [0, 0];
  for (let i = 0; i < pts.length; i++) {
    const t = u[i], mt = 1 - t, A1 = mul(t1, 3 * mt * mt * t), A2 = mul(t2, 3 * mt * t * t);
    C[0][0] += dot(A1, A1); C[0][1] += dot(A1, A2); C[1][1] += dot(A2, A2);
    const tmp = sub(pts[i], bez([first, first, last, last], t));
    X[0] += dot(A1, tmp); X[1] += dot(A2, tmp);
  }
  C[1][0] = C[0][1];
  const det = C[0][0] * C[1][1] - C[1][0] * C[0][1];
  let a1 = det ? (X[0] * C[1][1] - X[1] * C[0][1]) / det : 0, a2 = det ? (C[0][0] * X[1] - C[1][0] * X[0]) / det : 0;
  const seg = len(sub(last, first)), eps = 1e-6 * seg;
  if (a1 < eps || a2 < eps) { a1 = a2 = seg / 3; }
  return [first, add(first, mul(t1, a1)), add(last, mul(t2, a2)), last];
}
function maxErr(c, pts, u) { let m = 0, idx = (pts.length / 2) | 0; for (let i = 1; i < pts.length - 1; i++) { const d = len(sub(bez(c, u[i]), pts[i])); if (d > m) { m = d; idx = i; } } return [m, idx]; }
function reparam(c, pts, u) { return u.map((t, i) => { const d = sub(bez(c, t), pts[i]), d1 = bezD(c, t), d2 = bezDD(c, t); const den = dot(d1, d1) + dot(d, d2); return den ? Math.min(1, Math.max(0, t - dot(d, d1) / den)) : t; }); }
function fitCubic(pts, t1, t2, err, out) {
  if (pts.length <= 2) { const d = len(sub(pts[pts.length - 1], pts[0])) / 3; out.push([pts[0], add(pts[0], mul(t1, d)), add(pts[pts.length - 1], mul(t2, d)), pts[pts.length - 1]]); return; }
  let u = chordParams(pts), c = generate(pts, u, t1, t2), [e, split] = maxErr(c, pts, u);
  if (e < err) { out.push(c); return; }
  if (e < err * 4) for (let it = 0; it < 12; it++) { u = reparam(c, pts, u); c = generate(pts, u, t1, t2); [e, split] = maxErr(c, pts, u); if (e < err) { out.push(c); return; } }
  split = Math.max(1, Math.min(pts.length - 2, split));
  const tc = norm(sub(pts[split - 1], pts[split + 1]));
  fitCubic(pts.slice(0, split + 1), t1, tc, err, out);
  fitCubic(pts.slice(split), mul(tc, -1), t2, err, out);
}

/** A closed loop as SVG path data, corners kept sharp, curves fitted within `err` px. */
export function loopToPath(loop, { err = 0.35, dp = 2, offset = [0, 0], scale = 1 } = {}) {
  const cs = corners(loop);
  const pts = smooth(loop, cs).map(([x, y]) => [(x - offset[0]) * scale, (y - offset[1]) * scale]);
  const n = pts.length; const fmt = (v) => +v.toFixed(dp);
  const pieces = [];
  const cuts = cs.length > 1 ? cs : cs.length === 1 ? [cs[0], (cs[0] + ((n / 2) | 0)) % n] : [0, (n / 2) | 0];
  for (let k = 0; k < cuts.length; k++) {
    const a = cuts[k], b = cuts[(k + 1) % cuts.length];
    const seg = []; for (let i = a; ; i = (i + 1) % n) { seg.push(pts[i]); if (i === b) break; }
    if (seg.length < 2) continue;
    const m = Math.min(3, seg.length - 1);
    const t1 = norm(sub(seg[m], seg[0])), t2 = norm(sub(seg[seg.length - 1 - m], seg[seg.length - 1]));
    fitCubic(seg, t1, t2, err * scale, pieces);
  }
  let d = `M${fmt(pieces[0][0][0])} ${fmt(pieces[0][0][1])}`;
  for (const c of pieces) {
    const ab = sub(c[3], c[0]); const L2 = dot(ab, ab);
    const straight = L2 > 0 && [c[1], c[2]].every((q) => { const t = dot(sub(q, c[0]), ab) / L2; return len(sub(add(c[0], mul(ab, t)), q)) < 0.15 * scale; });
    d += straight ? `L${fmt(c[3][0])} ${fmt(c[3][1])}` : `C${fmt(c[1][0])} ${fmt(c[1][1])} ${fmt(c[2][0])} ${fmt(c[2][1])} ${fmt(c[3][0])} ${fmt(c[3][1])}`;
  }
  return d + "Z";
}
