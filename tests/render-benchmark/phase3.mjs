// Phase 3: does BP work when its inputs are produced automatically?
//
//   node tests/render-benchmark/phase3.mjs --live --stage extract --max-usd 0.6   analyse sources + references, print composed prompts, stop
//   node tests/render-benchmark/phase3.mjs --live --stage all --max-usd 2          + render BA / BA2 (+ AL baseline), verify everything, report
//
// Options: --cases BM-01,BM-05  --vision-model google/gemini-2.5-flash  --seed 12345  --stability  --compare-model <id>
// Without --live nothing is sent. Production routing, credits, pricing and settings are untouched.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { colourAccuracy, paletteMatch, photoCoverage, structuralDrift, dominantColours } from "./metrics.mjs";
import { analyzeMaterials, analyzeStructure, verifyFidelity, PROMPT_VERSION } from "./vision.mjs";
import { composeScene } from "./compose.mjs";
import { buildEnginePrompt } from "../../apps/api/src/lib/prompts.ts";
import { modelFor } from "../../apps/api/src/lib/models.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const require = createRequire(resolve(root, "apps/api/package.json"));
const sharp = require("sharp");

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const option = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const visionModel = option("vision-model", "google/gemini-2.5-flash");
const compareModel = option("compare-model", "");
const seed = Number(option("seed", "12345"));
const maxUsd = Number(option("max-usd", "2"));
const stage = option("stage", "all");
const wanted = option("cases", "").split(",").filter(Boolean);

const manifest = JSON.parse(readFileSync(resolve(here, "manifest.json"), "utf8"));
const extra = JSON.parse(readFileSync(resolve(here, "cases3.json"), "utf8"));
const cases = [...manifest.cases.map((c) => ({ id: c.id, title: c.title, source: c.source, reference: c.reference, legacy: true })), ...extra.cases.map((c) => ({ ...c, legacy: false }))].filter((c) => !wanted.length || wanted.includes(c.id));
const abs = (p) => resolve(root, p);

function loadFalKey() {
  if (process.env.FAL_KEY) return process.env.FAL_KEY;
  for (const f of ["apps/api/.dev.vars", "apps/api/.env.local"]) {
    if (!existsSync(abs(f))) continue;
    const m = readFileSync(abs(f), "utf8").match(/^FAL_KEY\s*=\s*"?([^"\r\n]+)"?/m);
    if (m) return m[1];
  }
  return null;
}

if (!flag("live")) {
  console.log(`Dry run. Would analyse ${new Set(cases.map((c) => c.source)).size} sources and ${new Set(cases.map((c) => c.reference)).size} references with ${visionModel},`);
  console.log(`then (stage all) render BA + BA2 for ${cases.length} cases (+ AL baseline for ${cases.filter((c) => !c.legacy).length}), then verify every output.`);
  console.log(`Cases: ${cases.map((c) => c.id).join(", ")}\nRe-run with --live --max-usd <cap> to spend.`);
  process.exit(0);
}
const key = loadFalKey();
if (!key) { console.error("No FAL_KEY found."); process.exit(2); }
const { createFalClient } = require("@fal-ai/client");
const fal = createFalClient({ credentials: key });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = resolve(here, "results", `phase3-${stamp}`);
const cacheDir = resolve(here, "results", "analysis-cache");
mkdirSync(outDir, { recursive: true });
mkdirSync(cacheDir, { recursive: true });

const ledger = { vision: 0, renders: 0, calls: [] };
const total = () => ledger.vision + ledger.renders;
const guard = () => { if (total() > maxUsd) { console.error(`Spend cap $${maxUsd} reached (≈$${total().toFixed(3)}). Stopping.`); throw new Error("cap"); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// -------- inputs, normalised once (lossless PNG for drawings, high-quality JPEG for references)
const uploads = new Map();
async function prepared(path, kind) {
  const bytes = readFileSync(abs(path));
  const png = kind === "source" || extname(path).toLowerCase() === ".png";
  const buf = await sharp(bytes).rotate().flatten({ background: "#ffffff" })[png ? "png" : "jpeg"](png ? {} : { quality: 95 }).toBuffer();
  return { buf, type: png ? "image/png" : "image/jpeg", sha: createHash("sha1").update(bytes).digest("hex").slice(0, 12) };
}
async function upload(path, kind) {
  const k = `${kind}:${path}`;
  if (!uploads.has(k)) {
    const p = await prepared(path, kind);
    uploads.set(k, { url: await fal.storage.upload(new Blob([new Uint8Array(p.buf)], { type: p.type })), sha: p.sha });
  }
  return uploads.get(k);
}
const uploadBuffer = async (buf, type) => fal.storage.upload(new Blob([new Uint8Array(buf)], { type }));

// -------- cached analyses
async function analysis(kind, path, model, fn, { fresh = false } = {}) {
  const { url, sha } = await upload(path, kind === "structure" ? "source" : "reference");
  const file = resolve(cacheDir, `${kind}_${sha}_${model.replace(/\W/g, "-")}_${PROMPT_VERSION}.json`);
  if (!fresh && existsSync(file)) return { ...JSON.parse(readFileSync(file, "utf8")), cached: true };
  guard();
  process.stdout.write(`  ${kind} ${path.split("/").pop()} [${model}] ... `);
  const result = await fn(fal, model, url);
  ledger.vision += result.costUsd;
  ledger.calls.push({ what: `${kind}:${path}`, model, costUsd: result.costUsd, ms: result.ms, tokens: result.tokens });
  console.log(`ok ${(result.ms / 1000).toFixed(1)}s $${result.costUsd.toFixed(4)} attempts ${result.attempts}`);
  if (!fresh) writeFileSync(file, JSON.stringify({ data: result.data, costUsd: result.costUsd, ms: result.ms, tokens: result.tokens, model }, null, 2));
  return { ...result, cached: false };
}

const countOf = (s) => ({ volumes: s.volumes.length, openings: s.openings.length, guardrails: s.guardrails.length, facadeElements: s.facadeElements.length, low: [...s.volumes, ...s.openings, ...s.guardrails, ...s.facadeElements].filter((e) => e.confidence === "low").length });

// =================================================================== stage 1: extraction
console.log(`\n== Stage 1: automated analysis with ${visionModel}`);
const analyses = {};
for (const c of cases) {
  const structure = await analysis("structure", c.source, visionModel, analyzeStructure);
  const materials = await analysis("materials", c.reference, visionModel, analyzeMaterials);
  analyses[c.id] = { structure, materials };
  const s = structure.data;
  console.log(`  ${c.id}: ${s.viewType}, ${s.storeys.count ?? "?"} storeys, roof ${s.roof.form}, counts ${JSON.stringify(countOf(s))}, unknowns ${s.unknowns.length}`);
}

if (flag("stability")) {
  console.log("\n== Stability: second independent extraction on two sources");
  for (const id of ["BM-01", "BM-05"].filter((i) => cases.some((c) => c.id === i))) {
    const c = cases.find((x) => x.id === id);
    const again = await analysis("structure", c.source, visionModel, analyzeStructure, { fresh: true });
    console.log(`  ${id}: run1 ${JSON.stringify(countOf(analyses[id].structure.data))}  run2 ${JSON.stringify(countOf(again.data))}`);
    const fins = (s) => s.facadeElements.find((e) => e.kind === "fins")?.count ?? null;
    console.log(`        fin count run1=${fins(analyses[id].structure.data)} run2=${fins(again.data)}`);
    analyses[id].stability = { run2: again.data };
  }
}
if (compareModel) {
  console.log(`\n== Model comparison: ${compareModel} on structure for BM-01 and BM-05`);
  for (const id of ["BM-01", "BM-05"].filter((i) => cases.some((c) => c.id === i))) {
    const c = cases.find((x) => x.id === id);
    const alt = await analysis("structure", c.source, compareModel, analyzeStructure);
    console.log(`  ${id}: ${visionModel} ${JSON.stringify(countOf(analyses[id].structure.data))}  ${compareModel} ${JSON.stringify(countOf(alt.data))}`);
    analyses[id].alt = { model: compareModel, data: alt.data, costUsd: alt.costUsd, ms: alt.ms };
  }
}

// measured colour anchors (deterministic) + composed prompts
const plans = [];
for (const c of cases) {
  const { structure, materials } = analyses[c.id];
  const measured = (await dominantColours(abs(c.reference))).slice(0, 3).map((x) => x.hex);
  for (const variant of ["plain", "locked"]) {
    const scene = composeScene(structure.data, materials.data, { variant, measuredPalette: measured });
    const prompt = buildEnginePrompt({ prompt: scene.text, style: "Photorealistic", sourceType: "drawing", hasReferences: false, preserveStructure: true, influence: 3 });
    plans.push({ caseId: c.id, approach: variant === "plain" ? "BA" : "BA2", prompt, scene });
  }
}
writeFileSync(resolve(outDir, "analyses.json"), JSON.stringify(analyses, null, 2));
writeFileSync(resolve(outDir, "prompts.json"), JSON.stringify(plans.map(({ caseId, approach, prompt, scene }) => ({ caseId, approach, prompt, detail: scene.detail })), null, 2));
console.log(`\nAnalysis spend ≈ $${ledger.vision.toFixed(4)}. Outputs: ${outDir}`);
if (stage === "extract") {
  for (const p of plans.filter((x) => x.approach === "BA2")) console.log(`\n--- ${p.caseId} BA2 prompt ---\n${p.prompt}`);
  process.exit(0);
}

// =================================================================== stage 2: renders
console.log("\n== Stage 2: renders (Kontext Pro, source only)");
const kontext = modelFor("prod", "drawing");
const references = modelFor("prod", "references"); // FLUX 3 edit, for the AL baseline on new cases
const outputs = []; // { caseId, approach, file, ... }
const runModel = async (modelId, input) => {
  const t0 = Date.now();
  const { request_id } = await fal.queue.submit(modelId, { input });
  for (;;) {
    const st = await fal.queue.status(modelId, { requestId: request_id });
    if (st.status === "COMPLETED") break;
    if (Date.now() - t0 > 10 * 60_000) throw new Error("timed out");
    await sleep(1500);
  }
  const { data } = await fal.queue.result(modelId, { requestId: request_id });
  const url = data.images?.[0]?.url ?? data.image?.url;
  if (!url) throw new Error("no image");
  return { bytes: Buffer.from(await (await fetch(url)).arrayBuffer()), ms: Date.now() - t0, requestId: request_id, returnedSeed: data.seed ?? null };
};

async function render(c, approach, modelId, input, promptText, estUsd, seedUsed) {
  guard();
  process.stdout.write(`  ${c.id} ${approach.padEnd(3)} ... `);
  try {
    const r = await runModel(modelId, input);
    const file = `${c.id}_${approach}.jpg`;
    writeFileSync(resolve(outDir, file), await sharp(r.bytes).jpeg({ quality: 92 }).toBuffer());
    ledger.renders += estUsd;
    outputs.push({ caseId: c.id, approach, file: resolve(outDir, file), fresh: true, modelId, seed: seedUsed, prompt: promptText, renderMs: r.ms, estUsd, requestId: r.requestId });
    console.log(`ok ${(r.ms / 1000).toFixed(1)}s`);
  } catch (e) {
    console.log(`FAILED ${String(e?.body ? JSON.stringify(e.body) : e?.message ?? e).slice(0, 200)}`);
    outputs.push({ caseId: c.id, approach, error: String(e?.message ?? e), fresh: true });
  }
}

for (const c of cases) {
  const src = (await upload(c.source, "source")).url;
  for (const approach of ["BA", "BA2"]) {
    const plan = plans.find((p) => p.caseId === c.id && p.approach === approach);
    await render(c, approach, kontext.id, kontext.buildInput({ imageUrl: src, referenceUrls: [], prompt: plan.prompt, influence: 3, preserveStructure: true, aspectRatio: "auto", seed }), plan.prompt, kontext.costMicros / 1e6, seed);
  }
  if (!c.legacy) {
    const ref = (await upload(c.reference, "reference")).url;
    const prompt =
      "Image 1 is an architectural drawing. Render it as a photorealistic photograph of that exact building from the same camera angle, with realistic sky, daylight and landscaping. " +
      "Keep its shape, roofs, windows, doors and proportions exactly as drawn and add nothing. Take only the colours and surface materials from image 2; do not copy image 2's building.";
    await render(c, "AL", references.id, references.buildInput({ imageUrl: src, referenceUrls: [ref], prompt, influence: 3, preserveStructure: true, aspectRatio: "auto" }), prompt, references.costMicros / 1e6, null);
  }
  if (c.legacy) {
    for (const [label, dir, name] of [["A", extra.legacyRuns.r1, `${c.id}_A.jpg`], ["B", extra.legacyRuns.r1, `${c.id}_B.jpg`], ["AL", extra.legacyRuns.r2, `${c.id}_AL.jpg`], ["BP1", extra.legacyRuns.r2, `${c.id}_BP1.jpg`]]) {
      const f = resolve(here, dir, name);
      if (existsSync(f)) outputs.push({ caseId: c.id, approach: label, file: f, fresh: false });
    }
  }
}

// =================================================================== stage 3: verification + metrics
console.log("\n== Stage 3: automated fidelity verification (same checklist for every approach on a case)");
for (const o of outputs) {
  if (!o.file) continue;
  const c = cases.find((x) => x.id === o.caseId);
  const srcPath = abs(c.source);
  const structure = analyses[c.id].structure.data;
  try {
    guard();
    const jpg = await sharp(o.file).rotate().jpeg({ quality: 90 }).toBuffer();
    const resultUrl = await uploadBuffer(jpg, "image/jpeg");
    const sourceUrl = (await upload(c.source, "source")).url;
    const v = await verifyFidelity(fal, visionModel, sourceUrl, resultUrl, structure);
    ledger.vision += v.costUsd;
    ledger.calls.push({ what: `verify:${o.caseId}:${o.approach}`, model: visionModel, costUsd: v.costUsd, ms: v.ms });
    const st = (s) => v.data.checks.filter((x) => x.status === s).map((x) => x.id);
    const judged = v.data.checks.filter((x) => x.status !== "unclear").length;
    o.verify = { kept: st("kept").length, changed: st("changed"), missing: st("missing"), judged, addedElements: v.data.addedElements, roof: v.data.roof, camera: v.data.camera, photorealistic: v.data.photorealistic, wallColourObserved: v.data.wallColourObserved, notes: v.data.checks.filter((x) => x.status === "changed" || x.status === "missing").map((x) => `${x.id}: ${x.note}`) };
    o.metrics = { structure: await structuralDrift(srcPath, o.file), coverage: await photoCoverage(o.file), palette: await paletteMatch(abs(c.reference), o.file), colour: await colourAccuracy(abs(c.reference), o.file) };
    console.log(`  ${o.caseId} ${o.approach.padEnd(3)} kept ${o.verify.kept}/${o.verify.judged} changed [${o.verify.changed.join(",")}] missing [${o.verify.missing.join(",")}] added [${o.verify.addedElements.join("; ")}] roof ${o.verify.roof.status} cam ${o.verify.camera.status} photo ${o.verify.photorealistic} walls "${o.verify.wallColourObserved}" dE ${o.metrics.colour.deltaE}`);
  } catch (e) {
    if (e.message === "cap") break;
    o.verifyError = String(e.message).slice(0, 300);
    console.log(`  ${o.caseId} ${o.approach} verify FAILED: ${o.verifyError}`);
  }
}

// =================================================================== report
const gitCommit = (() => { try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root }).toString().trim(); } catch { return "unknown"; } })();
writeFileSync(resolve(outDir, "run3.json"), JSON.stringify({ stamp, gitCommit, visionModel, seed, ledger, outputs: outputs.map((o) => ({ ...o, file: o.file?.replace(/\\/g, "/") })) }, null, 2));

for (const c of cases) {
  await sharp(abs(c.source)).rotate().flatten({ background: "#fff" }).resize({ width: 800, withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(resolve(outDir, `${c.id}_source.jpg`));
  await sharp(abs(c.reference)).rotate().flatten({ background: "#fff" }).resize({ width: 800, withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(resolve(outDir, `${c.id}_reference.jpg`));
  for (const o of outputs.filter((x) => x.caseId === c.id && x.file && !x.fresh)) {
    await sharp(o.file).resize({ width: 800, withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(resolve(outDir, `${c.id}_${o.approach}_legacy.jpg`));
  }
}
const esc = (s) => String(s).replace(/</g, "&lt;");
const cell = (o) => {
  const img = o.fresh ? `${o.caseId}_${o.approach}.jpg` : `${o.caseId}_${o.approach}_legacy.jpg`;
  if (!o.file) return `<figure class="fail"><figcaption><b>${o.approach}</b> failed: ${esc(o.error ?? "")}</figcaption></figure>`;
  const v = o.verify;
  return `<figure><img src="${img}"><figcaption><b>${o.approach}</b>${o.fresh ? "" : " (earlier round)"} ${o.renderMs ? (o.renderMs / 1000).toFixed(0) + "s" : ""}<br>${v ? `kept ${v.kept}/${v.judged} · roof ${v.roof.status} · camera ${v.camera.status} · photo ${v.photorealistic ? "yes" : "NO"}<br>changed/missing: ${esc([...v.changed, ...v.missing].join(", ") || "none")}<br>added: ${esc(v.addedElements.join("; ") || "none")}<br>walls: ${esc(v.wallColourObserved)} · ΔE ${o.metrics.colour.deltaE}` : esc(o.verifyError ?? "")}</figcaption></figure>`;
};
const html = `<!doctype html><meta charset="utf-8"><title>Phase 3 ${stamp}</title><style>body{font:14px system-ui;margin:24px;background:#fafafa}.row{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}figure{margin:0;width:330px}img{width:100%;border:1px solid #ccc}figcaption{font-size:12px;line-height:1.5}.fail{border:1px solid #c33;padding:8px}</style>
<h1>Phase 3: automated inputs <small>(${esc(visionModel)}, commit ${gitCommit})</small></h1><p>Vision spend ≈ $${ledger.vision.toFixed(3)}, render spend ≈ $${ledger.renders.toFixed(3)}. Verifier statements are model judgements; check them against the images.</p>
${cases.map((c) => `<section><h2>${c.id} - ${esc(c.title)}</h2><div class="row"><figure><img src="${c.id}_source.jpg"><figcaption><b>Source</b></figcaption></figure><figure><img src="${c.id}_reference.jpg"><figcaption><b>Reference</b></figcaption></figure>${outputs.filter((o) => o.caseId === c.id).map(cell).join("")}</div></section>`).join("")}`;
writeFileSync(resolve(outDir, "report.html"), html);
console.log(`\nDone. Spend ≈ $${total().toFixed(3)} (vision $${ledger.vision.toFixed(3)}, renders $${ledger.renders.toFixed(3)}). Report: ${resolve(outDir, "report.html").replace(/\\/g, "/")}`);
