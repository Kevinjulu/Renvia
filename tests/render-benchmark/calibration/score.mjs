// Scores the experimental model verifier against human labels, and annotators against each other.
//
//   node tests/render-benchmark/calibration/score.mjs annotations-A.json annotations-B.json [--adjudicated final.json]
//
// Positive class = a FAILURE the verifier should catch. The verifier is judged against the adjudicated labels when
// supplied, otherwise against annotator A. Thresholds come from CALIBRATION_PROTOCOL.md section 6.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const adjIdx = args.indexOf("--adjudicated");
const files = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--adjudicated");
if (files.length < 1) { console.error("Usage: score.mjs annotations-A.json [annotations-B.json] [--adjudicated final.json]"); process.exit(2); }
const load = (p) => JSON.parse(readFileSync(p, "utf8"));
const key = load(resolve(here, "../results/calibration-pack/key.json"));
const A = load(files[0]).labels;
const B = files[1] ? load(files[1]).labels : null;
const truth = adjIdx >= 0 ? load(args[adjIdx + 1]).labels : A;

// human labels -> boolean "failure present"
const fail = {
  roof: (l) => l.roof === "changed",
  camera: (l) => l.camera === "changed",
  added: (l) => Number(l.addedCount) > 0,
  notPhoto: (l) => l.photo === "no",
  reject: (l) => l.verdict === "reject",
};
// verifier -> same booleans
const vfail = {
  roof: (v) => v.roof === "changed",
  camera: (v) => v.camera === "changed",
  added: (v) => (v.added ?? []).length > 0,
  notPhoto: (v) => v.photorealistic === false,
  reject: (v) => v.roof === "changed" || v.camera === "changed" || (v.added ?? []).length > 0 || v.photorealistic === false,
};

function confusion(name) {
  let tp = 0, fn = 0, fp = 0, tn = 0;
  for (const it of key) {
    const t = truth[it.id];
    if (!t || !t.verdict) continue;
    const human = fail[name](t), model = vfail[name](it.verifier);
    if (human && model) tp++; else if (human) fn++; else if (model) fp++; else tn++;
  }
  const recall = tp + fn ? tp / (tp + fn) : NaN, falseAlarm = fp + tn ? fp / (fp + tn) : NaN;
  return { tp, fn, fp, tn, recall, falseAlarm };
}
const pct = (x) => (Number.isNaN(x) ? "n/a" : `${(100 * x).toFixed(0)}%`);
const target = { roof: [0.9, 0.15], camera: [0.9, 0.15], added: [0.9, 0.15], notPhoto: [0.9, 0.15], reject: [0.9, 0.15] };
console.log("Verifier vs human labels (positive = failure present)\n");
console.log("check      TP  FN  FP  TN   recall  false-alarm   meets protocol?");
for (const name of Object.keys(fail)) {
  const c = confusion(name);
  const ok = c.recall >= target[name][0] && c.falseAlarm <= target[name][1];
  console.log(`${name.padEnd(10)} ${String(c.tp).padStart(2)}  ${String(c.fn).padStart(2)}  ${String(c.fp).padStart(2)}  ${String(c.tn).padStart(2)}   ${pct(c.recall).padStart(5)}   ${pct(c.falseAlarm).padStart(7)}      ${Number.isNaN(c.recall) ? "insufficient data" : ok ? "yes" : "NO"}`);
}
console.log("\n(30 items give wide confidence intervals; a pass here justifies a larger set, not a release.)");

if (B) {
  const kappa = (name) => {
    let n = 0, agree = 0, a1 = 0, b1 = 0;
    for (const it of key) {
      const x = A[it.id], y = B[it.id];
      if (!x?.verdict || !y?.verdict) continue;
      const p = fail[name](x), q = fail[name](y);
      n++; if (p === q) agree++; if (p) a1++; if (q) b1++;
    }
    if (!n) return { n, kappa: NaN, agree: NaN };
    const po = agree / n, pe = (a1 / n) * (b1 / n) + (1 - a1 / n) * (1 - b1 / n);
    return { n, kappa: pe === 1 ? 1 : (po - pe) / (1 - pe), agree: po };
  };
  console.log("\nInter-annotator agreement (target kappa >= 0.70)");
  for (const name of Object.keys(fail)) { const k = kappa(name); console.log(`${name.padEnd(10)} n=${k.n} agreement ${pct(k.agree)} kappa ${Number.isNaN(k.kappa) ? "n/a" : k.kappa.toFixed(2)} ${k.kappa >= 0.7 ? "ok" : "ADJUDICATE"}`); }
  const disputed = key.filter((it) => A[it.id]?.verdict && B[it.id]?.verdict && Object.values(fail).some((fn) => fn(A[it.id]) !== fn(B[it.id]))).map((it) => it.id);
  console.log(`\nItems needing adjudication (${disputed.length}): ${disputed.join(", ") || "none"}`);
}

// repeats: same render shown twice under different blind ids
const repeatPairs = new Map();
for (const it of key) { const k = it.file; (repeatPairs.get(k) ?? repeatPairs.set(k, []).get(k)).push(it.id); }
let same = 0, total = 0;
for (const ids of repeatPairs.values()) if (ids.length === 2 && A[ids[0]]?.verdict && A[ids[1]]?.verdict) { total++; if (A[ids[0]].verdict === A[ids[1]].verdict) same++; }
console.log(`\nIntra-annotator consistency on repeated renders: ${total ? `${same}/${total} identical verdicts` : "n/a"}`);
