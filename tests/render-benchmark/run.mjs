// Render-fidelity benchmark. Never changes product code.
//
//   node tests/render-benchmark/run.mjs --selftest              free: sanity-check the metrics on saved renders
//   node tests/render-benchmark/run.mjs                         free: dry run, prints the plan, prompts and cost estimate
//   node tests/render-benchmark/run.mjs --live --max-usd 2      PAID: calls fal; refuses to start if the estimate exceeds the cap
//
// Options: --cases BM-01,BM-02  --approaches A,B,C1,C2,CIP  --seed 12345
//
// Approach A reuses the production prompt builder and model input builder, so the baseline is
// exactly what customers get today. Imports of the .ts files rely on Node's built-in type stripping.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { dirname, resolve, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { paletteMatch, photoCoverage, structuralDrift } from "./metrics.mjs";
import { buildEnginePrompt } from "../../apps/api/src/lib/prompts.ts";
import { modelFor } from "../../apps/api/src/lib/models.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const require = createRequire(resolve(root, "apps/api/package.json"));
const sharp = require("sharp");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const manifest = JSON.parse(readFileSync(resolve(here, "manifest.json"), "utf8"));
const seed = Number(option("seed", manifest.defaults.seed));
const maxUsd = Number(option("max-usd", "2"));
const wantedCases = option("cases", "").split(",").filter(Boolean);
const wantedApproaches = option("approaches", "A,B,C1,C2,CIP").split(",").filter(Boolean);
const cases = manifest.cases.filter((c) => !wantedCases.length || wantedCases.includes(c.id));

const FLUX_GENERAL = "fal-ai/flux-general/image-to-image";
const FLUX_GENERAL_USD_PER_MEGAPIXEL = 0.075; // registry figure from the previous strict route; reconcile with fal billing
const ALL_FEATURES = ["silhouette", "roof", "openings", "massing", "camera"];

// ---------------------------------------------------------------- self test (free)
if (flag("selftest")) {
  const dir = resolve(root, "tests/render-fidelity/fixtures");
  const source = resolve(dir, "Test Elevation/architectural elevation design 2.jpg");
  const samples = [
    ["flux3 maximum (design-2, visually close to source)", "Rendered Results/fidelity-design2-flux3-maximum-2026-10-03.jpg"],
    ["flux3 strong  (design-2, visually close to source)", "Rendered Results/fidelity-design2-flux3-strong-2026-10-03.jpg"],
    ["mismatched    (design-2, redesigned: hip roof, balconies)", "Rendered Results/fidelity-design2-mismatched-strong-2026-10-03.jpg"],
  ];
  console.log("Metric sanity check on saved renders (no API calls). Expect the redesigned one to score lowest.\n");
  for (const [label, file] of samples) {
    const drift = await structuralDrift(source, resolve(dir, file));
    console.log(label.padEnd(58), JSON.stringify(drift));
  }
  process.exit(0);
}

// ---------------------------------------------------------------- inputs
function loadFalKey() {
  if (process.env.FAL_KEY) return process.env.FAL_KEY;
  for (const file of ["apps/api/.dev.vars", "apps/api/.env.local"]) {
    const path = resolve(root, file);
    if (!existsSync(path)) continue;
    const match = readFileSync(path, "utf8").match(/^FAL_KEY\s*=\s*"?([^"\r\n]+)"?/m);
    if (match) return match[1];
  }
  return null;
}

const sizeFor = async (path) => {
  const meta = await sharp(path).rotate().metadata();
  // Match production's 1k tier: at most ~1 megapixel, which is also what fal bills per rounded-up MP.
  const scale = Math.sqrt(1_000_000 / (meta.width * meta.height));
  const snap = (v) => Math.max(256, Math.floor(v / 16) * 16);
  return { width: snap(meta.width * scale), height: snap(meta.height * scale) };
};

const abs = (rel) => resolve(root, rel);
const specPrompt = (testCase) =>
  buildEnginePrompt({
    prompt: `Apply these finishes to the existing surfaces only and never add elements the drawing does not contain: ${testCase.materialSpec}`,
    style: "Photorealistic",
    sourceType: "drawing",
    hasReferences: false,
    preserveStructure: true,
    influence: 3,
  });

// Each approach returns { modelId, input, estUsd } given fal-reachable URLs.
const approaches = {
  A: async (testCase, urls) => {
    const model = modelFor("prod", "fidelity");
    const prompt = buildEnginePrompt({
      prompt: manifest.defaults.userPrompt,
      style: "Photorealistic",
      sourceType: "drawing",
      hasReferences: true,
      preserveStructure: true,
      influence: 3,
      strictFidelity: true,
      protectedFeatures: ALL_FEATURES,
    });
    return {
      modelId: model.id,
      prompt,
      estUsd: model.costMicros / 1e6,
      input: model.buildInput({ imageUrl: urls.source, referenceUrls: [urls.reference], prompt, influence: 3, preserveStructure: true, aspectRatio: "auto" }),
    };
  },
  B: async (testCase, urls) => {
    const model = modelFor("prod", "drawing");
    const prompt = specPrompt(testCase);
    return {
      modelId: model.id,
      prompt,
      estUsd: model.costMicros / 1e6,
      input: model.buildInput({ imageUrl: urls.source, referenceUrls: [], prompt, influence: 3, preserveStructure: true, aspectRatio: "auto", seed }),
    };
  },
  ...Object.fromEntries(
    [["C1", 0.6], ["C2", 0.85]].map(([id, strength]) => [
      id,
      async (testCase, urls, sourcePath) => {
        const size = await sizeFor(sourcePath);
        const prompt = specPrompt(testCase);
        return {
          modelId: FLUX_GENERAL,
          prompt,
          estUsd: Math.ceil((size.width * size.height) / 1e6) * FLUX_GENERAL_USD_PER_MEGAPIXEL,
          input: {
            image_url: urls.source,
            prompt,
            strength,
            num_inference_steps: 28,
            guidance_scale: 3.5,
            easycontrols: [{ control_method_url: "canny", image_url: urls.source, image_control_type: "spatial", scale: 1 }],
            image_size: size,
            output_format: "jpeg",
            seed,
          },
        };
      },
    ]),
  ),
  // ---- Round 2 ----
  AL: async (testCase, urls) => {
    const model = modelFor("prod", "fidelity");
    const prompt =
      "Image 1 is an architectural drawing. Render it as a photorealistic photograph of that exact building from the same camera angle, " +
      "with realistic sky, daylight and landscaping. Keep its shape, roofs, windows, doors and proportions exactly as drawn and add nothing. " +
      "Take only the colours and surface materials from image 2; do not copy image 2's building.";
    return {
      modelId: model.id,
      prompt,
      estUsd: model.costMicros / 1e6,
      input: model.buildInput({ imageUrl: urls.source, referenceUrls: [urls.reference], prompt, influence: 3, preserveStructure: true, aspectRatio: "auto" }),
    };
  },
  ...Object.fromEntries(
    [["BP1", 0], ["BP2", 1], ["BP3", 2]].map(([id, offset]) => [
      id,
      async (testCase, urls) => {
        const model = modelFor("prod", "drawing");
        const prompt = buildEnginePrompt({
          prompt:
            `Apply these finishes to the existing surfaces only: ${testCase.materialSpec} ` +
            `Keep every element of the drawing exactly as it is: ${testCase.structureInventory} Do not add elements the drawing does not contain.`,
          style: "Photorealistic",
          sourceType: "drawing",
          hasReferences: false,
          preserveStructure: true,
          influence: 3,
        });
        return {
          modelId: model.id,
          prompt,
          seed: seed + offset,
          estUsd: model.costMicros / 1e6,
          input: model.buildInput({ imageUrl: urls.source, referenceUrls: [], prompt, influence: 3, preserveStructure: true, aspectRatio: "auto", seed: seed + offset }),
        };
      },
    ]),
  ),
  CP: async (testCase, urls, sourcePath) => {
    const size = await sizeFor(sourcePath);
    const prompt = specPrompt(testCase);
    return {
      modelId: FLUX_GENERAL,
      prompt,
      estUsd: Math.ceil((size.width * size.height) / 1e6) * FLUX_GENERAL_USD_PER_MEGAPIXEL,
      input: {
        // A blank canvas as the img2img base: the sketch only constrains structure through Canny,
        // so the model has to paint the building instead of returning the drawing.
        image_url: await urls.blank(size),
        prompt,
        strength: 0.95,
        num_inference_steps: 28,
        guidance_scale: 3.5,
        easycontrols: [{ control_method_url: "canny", image_url: urls.source, image_control_type: "spatial", scale: 1 }],
        image_size: size,
        output_format: "jpeg",
        seed,
      },
    };
  },
  CIP: async (testCase, urls, sourcePath) => {
    const base = await approaches.C1(testCase, urls, sourcePath);
    return {
      ...base,
      input: {
        ...base.input,
        ip_adapters: [
          {
            path: "XLabs-AI/flux-ip-adapter",
            weight_name: "ip_adapter.safetensors",
            image_encoder_path: "openai/clip-vit-large-patch14",
            image_url: urls.reference,
            scale: 0.6,
          },
        ],
      },
    };
  },
};

// ---------------------------------------------------------------- plan + dry run
const runs = cases.flatMap((testCase) => wantedApproaches.filter((id) => approaches[id]).map((id) => ({ testCase, id })));
const placeholderUrls = { source: "<source-url>", reference: "<reference-url>", blank: async () => "<blank-canvas-url>" };
const plan = [];
for (const { testCase, id } of runs) {
  const built = await approaches[id](testCase, placeholderUrls, abs(testCase.source));
  plan.push({ testCase, id, built });
}
const estimate = plan.reduce((sum, p) => sum + p.built.estUsd, 0);

console.log(`\nPlan: ${plan.length} renders, ${cases.length} case(s), approaches ${wantedApproaches.join(",")}, seed ${seed}`);
console.log(`Estimated fal spend: $${estimate.toFixed(3)} (registry figures; reconcile against the fal dashboard)\n`);
for (const p of plan) console.log(`  ${p.testCase.id} ${p.id.padEnd(3)} ${p.built.modelId.padEnd(46)} ~$${p.built.estUsd.toFixed(3)}`);

if (!flag("live")) {
  const sample = plan.find((p) => p.id === "A") ?? plan[0];
  if (sample) {
    console.log(`\nExample prompt (${sample.testCase.id} ${sample.id}):\n${sample.built.prompt}`);
    const { image_url, image_urls, ...rest } = sample.built.input;
    console.log(`\nExample input (images elided):\n${JSON.stringify(rest, null, 2)}`);
  }
  console.log("\nDry run only. Re-run with --live --max-usd <cap> to spend.");
  process.exit(0);
}

if (estimate > maxUsd) {
  console.error(`\nRefusing to start: estimate $${estimate.toFixed(3)} exceeds --max-usd ${maxUsd}.`);
  process.exit(2);
}
const key = loadFalKey();
if (!key) {
  console.error("\nNo FAL_KEY found in the environment or apps/api/.dev.vars.");
  process.exit(2);
}

// ---------------------------------------------------------------- live run
const { createFalClient } = require("@fal-ai/client");
const fal = createFalClient({ credentials: key });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = resolve(here, "results", stamp);
mkdirSync(outDir, { recursive: true });

const mime = (path) => ({ ".png": "image/png", ".webp": "image/webp" })[extname(path).toLowerCase()] ?? "image/jpeg";
const uploadCache = new Map();
async function upload(path) {
  if (!uploadCache.has(path)) {
    let bytes = readFileSync(path);
    let type = mime(path);
    if (extname(path).toLowerCase() === ".jfif") {
      bytes = await sharp(bytes).jpeg({ quality: 95 }).toBuffer(); // same pixels, a type fal recognises
      type = "image/jpeg";
    }
    uploadCache.set(path, await fal.storage.upload(new Blob([new Uint8Array(bytes)], { type })));
  }
  return uploadCache.get(path);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gitCommit = (() => {
  try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root }).toString().trim(); } catch { return "unknown"; }
})();

const records = [];
let spent = 0;
for (const { testCase, id } of runs) {
  if (spent > maxUsd) { console.error("Spend cap reached; stopping."); break; }
  const sourcePath = abs(testCase.source);
  const referencePath = abs(testCase.reference);
  const urls = {
    source: await upload(sourcePath),
    reference: await upload(referencePath),
    blank: async ({ width, height }) =>
      fal.storage.upload(new Blob([new Uint8Array(await sharp({ create: { width, height, channels: 3, background: "#808080" } }).png().toBuffer())], { type: "image/png" })),
  };
  const built = await approaches[id](testCase, urls, sourcePath);
  const record = {
    case: testCase.id, approach: id, model: built.modelId, seed: built.seed ?? (["A", "AL"].includes(id) ? null : seed), prompt: built.prompt,
    input: { ...built.input, image_url: undefined, image_urls: undefined, easycontrols: built.input.easycontrols?.map((e) => ({ ...e, image_url: "<source>" })), ip_adapters: built.input.ip_adapters?.map((e) => ({ ...e, image_url: "<reference>" })) },
    estUsd: built.estUsd, gitCommit,
  };
  process.stdout.write(`${testCase.id} ${id.padEnd(3)} ... `);
  const started = Date.now();
  try {
    const { request_id } = await fal.queue.submit(built.modelId, { input: built.input });
    let firstRunning = null;
    for (;;) {
      const status = await fal.queue.status(built.modelId, { requestId: request_id });
      if (status.status === "IN_PROGRESS" && !firstRunning) firstRunning = Date.now();
      if (status.status === "COMPLETED") break;
      if (Date.now() - started > 10 * 60_000) throw new Error("timed out after 10 minutes");
      await sleep(1500);
    }
    const { data } = await fal.queue.result(built.modelId, { requestId: request_id });
    const finished = Date.now();
    const imageUrl = data.images?.[0]?.url ?? data.image?.url;
    if (!imageUrl) throw new Error("no image in result");
    const bytes = Buffer.from(await (await fetch(imageUrl)).arrayBuffer());
    const file = `${testCase.id}_${id}.jpg`;
    writeFileSync(resolve(outDir, file), await sharp(bytes).jpeg({ quality: 92 }).toBuffer());
    const meta = await sharp(bytes).metadata();
    Object.assign(record, {
      status: "ok", file, requestId: request_id, totalMs: finished - started, runMs: firstRunning ? finished - firstRunning : null,
      falTimings: data.timings ?? null, returnedSeed: data.seed ?? null, outputSize: `${meta.width}x${meta.height}`,
      structure: await structuralDrift(sourcePath, resolve(outDir, file)),
      palette: await paletteMatch(referencePath, resolve(outDir, file)),
      coverage: await photoCoverage(resolve(outDir, file)),
    });
    spent += built.estUsd;
    console.log(`ok ${(record.totalMs / 1000).toFixed(1)}s coverage=${record.coverage} lift=${record.structure.lift} recall=${record.structure.recall} precision=${record.structure.precision}`);
  } catch (error) {
    // A rejected request is billed nothing by fal; it is still a finding (e.g. unsupported combination).
    Object.assign(record, { status: "failed", totalMs: Date.now() - started, error: String(error?.body ? JSON.stringify(error.body).slice(0, 600) : error?.message ?? error) });
    console.log(`FAILED ${record.error}`);
  }
  records.push(record);
  writeFileSync(resolve(outDir, "run.json"), JSON.stringify({ stamp, gitCommit, seed, estimatedSpendUsd: spent, records }, null, 2));
}

// ---------------------------------------------------------------- report
const rel = (path) => path.replace(/\\/g, "/");
for (const testCase of cases) {
  for (const [kind, path] of [["source", testCase.source], ["reference", testCase.reference]]) {
    const target = resolve(outDir, `${testCase.id}_${kind}.jpg`);
    await sharp(abs(path)).rotate().flatten({ background: "#fff" }).resize({ width: 900, withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(target);
  }
}
const rubric = ["Roof", "Openings", "Proportions", "No added elements", "Material accuracy", "Realism"];
const cell = (r, testCase) =>
  r.status === "ok"
    ? `<figure><img src="${r.file}"><figcaption><b>${r.approach}</b> ${(r.totalMs / 1000).toFixed(0)}s · ~$${r.estUsd.toFixed(3)}<br>coverage ${r.coverage} · lift ${r.structure.lift} · recall ${r.structure.recall} · prec ${r.structure.precision} · palette ${r.palette}<br>
       ${rubric.map((name, i) => `<label>${name}<select data-k="${testCase.id}|${r.approach}|${i}"><option value="">–</option><option>0</option><option>1</option><option>2</option></select></label>`).join("")}</figcaption></figure>`
    : `<figure class="fail"><figcaption><b>${r.approach}</b> failed<br><small>${(r.error ?? "").replace(/</g, "&lt;")}</small></figcaption></figure>`;
const html = `<!doctype html><meta charset="utf-8"><title>Render benchmark ${stamp}</title>
<style>body{font:14px system-ui;margin:24px;background:#fafafa;color:#111}section{margin:0 0 48px}.row{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
figure{margin:0;width:340px}img{width:100%;border:1px solid #ccc}figcaption{font-size:12px;line-height:1.5}label{display:inline-block;margin:2px 8px 0 0}.fail{border:1px solid #c33;padding:8px}</style>
<h1>Render benchmark ${stamp} <small>(commit ${gitCommit}, seed ${seed})</small></h1>
<p>Scores: 0 = fails, 1 = partial, 2 = faithful. <b>lift</b> = structural agreement above a mirror-flipped control (a signal, not proof). Scores are kept in this browser; <button onclick="exportScores()">export JSON</button></p>
${cases.map((testCase) => `<section><h2>${testCase.id} — ${testCase.title}</h2><p><b>Must keep:</b> ${testCase.mustKeep.join("; ")}<br><b>Must never add:</b> ${testCase.mustNeverAdd.join("; ")}</p>
<div class="row"><figure><img src="${testCase.id}_source.jpg"><figcaption><b>Source</b></figcaption></figure><figure><img src="${testCase.id}_reference.jpg"><figcaption><b>Reference</b></figcaption></figure>
${records.filter((r) => r.case === testCase.id).map((r) => cell(r, testCase)).join("")}</div></section>`).join("")}
<script>const s=JSON.parse(localStorage.getItem("bm-${stamp}")||"{}");document.querySelectorAll("select[data-k]").forEach(e=>{e.value=s[e.dataset.k]||"";e.onchange=()=>{s[e.dataset.k]=e.value;localStorage.setItem("bm-${stamp}",JSON.stringify(s))}});
function exportScores(){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(s,null,2)],{type:"application/json"}));a.download="rubric-scores.json";a.click()}</script>`;
writeFileSync(resolve(outDir, "report.html"), html);
console.log(`\nDone. Estimated spend $${spent.toFixed(3)}. Open ${rel(resolve(outDir, "report.html"))}`);
