// Phase 4: do visual material swatches improve Kontext colour/texture fidelity without leaking reference architecture?
//
//   node tests/render-benchmark/phase4.mjs --boards              free: build the swatch boards for every case and stop
//   node tests/render-benchmark/phase4.mjs --live --max-usd 2.4  PAID: renders + measurement
//
// Variants (same source, same seed, same guidance, same fixed lighting and landscape):
//   BA2n  production Kontext Pro endpoint, text specification + structure inventory (the Phase 3 BA2 with lighting and
//         landscape made independent of the reference)
//   SW0   CONTROL: the experimental multi-image Kontext endpoint with the source image only and the BA2n prompt, to
//         separate the endpoint effect from the swatch effect
//   SW1   source + unlabelled swatch board
//   SW2   source + labelled swatch board (explicit role association)
//   SW3   source + labelled swatch board + text material instructions + structure inventory
//
// Measured (deterministic): masked-wall colour with CIEDE2000, lighting normalised; edge agreement; photo coverage.
// Experimental model judgements (never ground truth): fidelity verifier, material-assignment inspector.
// Production routing, Studio settings, pricing, credits and refunds are untouched.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ciede2000, dominantColours, maskedWallColour, photoCoverage, structuralDrift, wallColourDelta } from "./metrics.mjs";
import { analyzeMaterials, analyzeStructure, inspectMaterials, verifyFidelity, PROMPT_VERSION } from "./vision.mjs";
import { composeScene } from "./compose.mjs";
import { buildSwatchBoard, ROLE_LABEL } from "./swatches.mjs";
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
const seed = Number(option("seed", "12345"));
const maxUsd = Number(option("max-usd", "2.4"));
const wanted = option("cases", "").split(",").filter(Boolean);
const variantsWanted = option("variants", "BA2n,SW0,SW1,SW2,SW3").split(",");

const MULTI_ENDPOINT = "fal-ai/flux-pro/kontext/multi"; // experimental, max 2 input images, $0.04/image, supports seed
const SAM_MODEL = "fal-ai/sam-3/image"; // $0.005/request
const SAM_USD = 0.005;
const MULTI_USD = 0.04;
const GUIDANCE = 5; // production Kontext uses byInfluence(3) = 5; the same value is used everywhere here

const manifest = JSON.parse(readFileSync(resolve(here, "manifest.json"), "utf8"));
const extra = JSON.parse(readFileSync(resolve(here, "cases3.json"), "utf8"));
const cases = [...manifest.cases.map((c) => ({ id: c.id, title: c.title, source: c.source, reference: c.reference, legacy: true })), ...extra.cases.map((c) => ({ ...c, legacy: false }))].filter((c) => !wanted.length || wanted.includes(c.id));
const abs = (p) => resolve(root, p);
const p3Dir = readdirLatest("phase3-");
function readdirLatest(prefix) {
  const dir = resolve(here, "results");
  if (!existsSync(dir)) return null;
  return require("node:fs").readdirSync(dir).filter((d) => d.startsWith(prefix)).sort().pop() ?? null;
}

function loadFalKey() {
  if (process.env.FAL_KEY) return process.env.FAL_KEY;
  for (const f of ["apps/api/.dev.vars", "apps/api/.env.local"]) {
    if (!existsSync(abs(f))) continue;
    const m = readFileSync(abs(f), "utf8").match(/^FAL_KEY\s*=\s*"?([^"\r\n]+)"?/m);
    if (m) return m[1];
  }
  return null;
}
const key = loadFalKey();
if (!key) { console.error("No FAL_KEY found."); process.exit(2); }
const { createFalClient } = require("@fal-ai/client");
const fal = createFalClient({ credentials: key });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = resolve(here, "results", `phase4-${stamp}`);
const cacheDir = resolve(here, "results", "analysis-cache");
mkdirSync(outDir, { recursive: true });
mkdirSync(cacheDir, { recursive: true });

const ledger = { vision: 0, sam: 0, renders: 0 };
const total = () => ledger.vision + ledger.sam + ledger.renders;
const guard = () => { if (total() > maxUsd) throw new Error(`cap: $${total().toFixed(3)} > $${maxUsd}`); };

// ------------------------------------------------------------------ inputs
const uploads = new Map();
async function upload(path, kind) {
  const k = `${kind}:${path}`;
  if (!uploads.has(k)) {
    const raw = readFileSync(abs(path));
    const png = kind === "source";
    const buf = await sharp(raw).rotate().flatten({ background: "#ffffff" })[png ? "png" : "jpeg"](png ? {} : { quality: 95 }).toBuffer();
    uploads.set(k, { url: await fal.storage.upload(new Blob([new Uint8Array(buf)], { type: png ? "image/png" : "image/jpeg" })), sha: createHash("sha1").update(raw).digest("hex").slice(0, 12) });
  }
  return uploads.get(k);
}
const uploadBuf = (buf, type) => fal.storage.upload(new Blob([new Uint8Array(buf)], { type }));

async function cachedAnalysis(kind, path, fn) {
  const { url, sha } = await upload(path, kind === "structure" ? "source" : "reference");
  const file = resolve(cacheDir, `${kind}_${sha}_${visionModel.replace(/\W/g, "-")}_${PROMPT_VERSION}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")).data;
  guard();
  const r = await fn(fal, visionModel, url);
  ledger.vision += r.costUsd;
  writeFileSync(file, JSON.stringify({ data: r.data, costUsd: r.costUsd, ms: r.ms, tokens: r.tokens, model: visionModel }, null, 2));
  return r.data;
}

// ------------------------------------------------------------------ SAM wall masks (measured colour needs a wall region)
async function maskBytes(url) {
  if (url.startsWith("data:")) return Buffer.from(url.split(",")[1], "base64");
  return Buffer.from(await (await fetch(url)).arrayBuffer());
}
async function wallMask(imageUrl) {
  guard();
  const { data } = await fal.subscribe(SAM_MODEL, {
    input: { image_url: imageUrl, prompt: "exterior wall", apply_mask: false, sync_mode: true, output_format: "png", return_multiple_masks: true, max_masks: 8 },
    logs: false,
  });
  ledger.sam += SAM_USD;
  const urls = (data.masks ?? []).map((m) => m.url).filter(Boolean);
  if (!urls.length && data.image?.url) urls.push(data.image.url);
  if (!urls.length) return null;
  const layers = await Promise.all(urls.map(maskBytes));
  const meta = await sharp(layers[0]).metadata();
  const acc = new Uint8Array(meta.width * meta.height);
  for (const layer of layers) {
    const g = await sharp(layer).resize(meta.width, meta.height, { fit: "fill" }).greyscale().raw().toBuffer();
    for (let i = 0; i < acc.length; i++) if (g[i] > 127) acc[i] = 255;
  }
  return sharp(Buffer.from(acc), { raw: { width: meta.width, height: meta.height, channels: 1 } }).png().toBuffer();
}
async function wallColourOf(path, url) {
  const mask = await wallMask(url);
  return mask ? maskedWallColour(path, mask) : null;
}

// ------------------------------------------------------------------ prompts
const LIGHTING = "Lighting: neutral bright daylight with a light overcast sky; do not use the lighting, time of day or weather of any other image. Landscape: simple lawn and a few shrubs.";
const SWATCH_INTRO =
  "Image 1 is an architectural drawing. Render it as a photorealistic photograph of that exact building from the same camera angle, keeping its shape, roofs, windows, doors and proportions exactly as drawn and adding nothing. " +
  "Image 2 is a material swatch board, not a building: each tile shows the colour and texture of one surface. Use image 2 only for the colours and textures of the building's surfaces and never copy any shape, layout or object from it. " +
  "Do not draw the swatch board, its tiles or any label in the picture.";
const roleSentence = (tiles) =>
  "Each tile is labelled with the surface it is for: " +
  tiles.map((t) => `the ${t.label} tile gives the colour and texture of ${{ WALLS: "the main walls", "SECOND WALLS": "the secondary walls", CLADDING: "the cladding", BASE: "the base or plinth", "WINDOW FRAMES": "all window and door frames", DOORS: "the doors", SOFFIT: "soffits and fascias", PAVING: "the paving" }[t.label] ?? t.label.toLowerCase()}`).join("; ") +
  ". Apply each tile only to its own surface. Match each tile's colour exactly; do not warm, tint or cream-tone it.";

function promptsFor(testCase, structure, materials, tiles, measured) {
  const base = composeScene(structure, materials, { variant: "locked", measuredPalette: measured, neutralLighting: true, genericLandscape: true });
  const ba2 = buildEnginePrompt({ prompt: base.text, style: "Photorealistic", sourceType: "drawing", hasReferences: false, preserveStructure: true, influence: 3 });
  const noHex = composeScene(structure, materials, { variant: "locked", measuredPalette: [], neutralLighting: true, genericLandscape: true, omitHex: true });
  return {
    BA2n: ba2,
    SW0: ba2,
    SW1: `${SWATCH_INTRO} ${LIGHTING}`,
    SW2: `${SWATCH_INTRO} ${roleSentence(tiles)} ${LIGHTING}`,
    SW3: `${SWATCH_INTRO} ${roleSentence(tiles)} ${noHex.text} ${LIGHTING}`,
  };
}

// ------------------------------------------------------------------ boards (free)
console.log("== Swatch boards");
const prepared = {};
for (const c of cases) {
  const structure = await cachedAnalysis("structure", c.source, analyzeStructure);
  const materials = await cachedAnalysis("materials", c.reference, analyzeMaterials);
  const labelled = await buildSwatchBoard(abs(c.reference), materials, { labels: true });
  const plain = await buildSwatchBoard(abs(c.reference), materials, { labels: false });
  writeFileSync(resolve(outDir, `${c.id}_board_labelled.png`), labelled.png);
  writeFileSync(resolve(outDir, `${c.id}_board_plain.png`), plain.png);
  const measured = (await dominantColours(abs(c.reference))).slice(0, 3).map((x) => x.hex);
  prepared[c.id] = { structure, materials, labelled, plain, measured, prompts: promptsFor(c, structure, materials, labelled.tiles, measured) };
  console.log(`  ${c.id}: ${labelled.tiles.length} tiles (${labelled.tiles.map((t) => `${t.label}${t.patch ? "" : "*"} ${t.chipHex}`).join(", ")})  * = chip only`);
}
writeFileSync(resolve(outDir, "boards.json"), JSON.stringify(Object.fromEntries(Object.entries(prepared).map(([id, p]) => [id, { tiles: p.labelled.tiles, prompts: p.prompts }])), null, 2));
if (flag("boards")) { console.log(`\nBoards written to ${outDir}`); process.exit(0); }
if (!flag("live")) {
  const n = cases.length * variantsWanted.length;
  const est = n * 0.04 + (cases.length + n + cases.length * 2) * SAM_USD + n * 0.008;
  console.log(`\nDry run: ${n} renders (${variantsWanted.join(",")}) over ${cases.length} cases, estimated $${est.toFixed(2)}. Re-run with --live --max-usd <cap>.`);
  process.exit(0);
}

// ------------------------------------------------------------------ renders
const kontext = modelFor("prod", "drawing");
const runQueue = async (endpoint, input) => {
  const t0 = Date.now();
  const { request_id } = await fal.queue.submit(endpoint, { input });
  for (;;) {
    const st = await fal.queue.status(endpoint, { requestId: request_id });
    if (st.status === "COMPLETED") break;
    if (Date.now() - t0 > 10 * 60_000) throw new Error("timed out");
    await sleep(1500);
  }
  const { data } = await fal.queue.result(endpoint, { requestId: request_id });
  const url = data.images?.[0]?.url;
  if (!url) throw new Error("no image");
  return { bytes: Buffer.from(await (await fetch(url)).arrayBuffer()), ms: Date.now() - t0, requestId: request_id, returnedSeed: data.seed ?? null };
};

const outputs = [];
console.log("\n== Renders");
for (const c of cases) {
  const p = prepared[c.id];
  const source = (await upload(c.source, "source")).url;
  const boardL = await uploadBuf(p.labelled.png, "image/png");
  const boardP = await uploadBuf(p.plain.png, "image/png");
  for (const variant of variantsWanted) {
    const prompt = p.prompts[variant];
    const common = { guidance_scale: GUIDANCE, output_format: "jpeg", seed };
    const [endpoint, input] =
      variant === "BA2n" ? [kontext.id, kontext.buildInput({ imageUrl: source, referenceUrls: [], prompt, influence: 3, preserveStructure: true, aspectRatio: "auto", seed })]
      : variant === "SW0" ? [MULTI_ENDPOINT, { ...common, prompt, image_urls: [source] }]
      : variant === "SW1" ? [MULTI_ENDPOINT, { ...common, prompt, image_urls: [source, boardP] }]
      : [MULTI_ENDPOINT, { ...common, prompt, image_urls: [source, boardL] }];
    process.stdout.write(`  ${c.id} ${variant.padEnd(4)} ... `);
    try {
      guard();
      const r = await runQueue(endpoint, input);
      const file = resolve(outDir, `${c.id}_${variant}.jpg`);
      writeFileSync(file, await sharp(r.bytes).jpeg({ quality: 92 }).toBuffer());
      ledger.renders += MULTI_USD;
      outputs.push({ caseId: c.id, variant, file, endpoint, prompt, seed, guidance: GUIDANCE, renderMs: r.ms, estUsd: 0.04, requestId: r.requestId, returnedSeed: r.returnedSeed });
      console.log(`ok ${(r.ms / 1000).toFixed(1)}s`);
    } catch (e) {
      console.log(`FAILED ${String(e?.body ? JSON.stringify(e.body) : e?.message ?? e).slice(0, 220)}`);
      outputs.push({ caseId: c.id, variant, error: String(e?.message ?? e) });
      if (String(e?.message).startsWith("cap")) break;
    }
  }
}

// ------------------------------------------------------------------ legacy comparators (already rendered in Phase 3; measured here the same way)
if (p3Dir) {
  for (const c of cases) {
    for (const [variant, names] of [["BA2-p3", [`${c.id}_BA2.jpg`]], ["AL", [`${c.id}_AL.jpg`, `${c.id}_AL_legacy.jpg`]]]) {
      const f = names.map((n) => resolve(here, "results", p3Dir, n)).find((x) => existsSync(x));
      if (f) outputs.push({ caseId: c.id, variant, file: f, legacy: true });
    }
  }
}

// ------------------------------------------------------------------ measurement
console.log("\n== Measurement (wall colour: SAM mask + CIEDE2000; verifier and inspector are experimental model judgements)");
const refWall = {};
for (const c of cases) {
  const ref = (await upload(c.reference, "reference")).url;
  try { refWall[c.id] = await wallColourOf(abs(c.reference), ref); } catch (e) { refWall[c.id] = null; }
}
for (const o of outputs) {
  if (!o.file) continue;
  const c = cases.find((x) => x.id === o.caseId);
  const p = prepared[o.caseId];
  try {
    const jpg = await sharp(o.file).rotate().jpeg({ quality: 90 }).toBuffer();
    const url = await uploadBuf(jpg, "image/jpeg");
    const sourceUrl = (await upload(c.source, "source")).url;
    o.measured = {
      structure: await structuralDrift(abs(c.source), o.file),
      coverage: await photoCoverage(o.file),
      wall: wallColourDelta(refWall[c.id], await wallColourOf(o.file, url)),
    };
    if (!o.legacy) {
      guard();
      const v = await verifyFidelity(fal, visionModel, sourceUrl, url, p.structure);
      ledger.vision += v.costUsd;
      const st = (s) => v.data.checks.filter((x) => x.status === s).map((x) => x.id);
      const judged = v.data.checks.filter((x) => x.status !== "unclear").length;
      const openingIds = new Set(p.structure.openings.map((e) => e.id));
      const openings = v.data.checks.filter((x) => openingIds.has(x.id) && x.status !== "unclear");
      o.verifier = {
        keptRatio: +(st("kept").length / Math.max(1, judged)).toFixed(2),
        openingsKeptRatio: +(openings.filter((x) => x.status === "kept").length / Math.max(1, openings.length)).toFixed(2),
        changed: st("changed"), missing: st("missing"), added: v.data.addedElements, roof: v.data.roof.status, camera: v.data.camera.status,
        photorealistic: v.data.photorealistic, wallColourObserved: v.data.wallColourObserved,
      };
      const roles = [...new Set(p.labelled.tiles.map((t) => t.role))];
      const obs = await inspectMaterials(fal, visionModel, url, roles);
      ledger.vision += obs.costUsd;
      o.inspector = p.labelled.tiles.map((t) => {
        const seen = obs.data.roles.find((r) => r.role === t.role);
        const dE = seen?.hex && seen.visible ? +ciede2000(srgb(t.chipHex), srgb(seen.hex)).toFixed(1) : null;
        return { role: t.role, target: t.chipHex, observed: seen?.hex ?? null, colourName: seen?.colourName ?? null, visible: seen?.visible ?? false, deltaE00: dE };
      });
    }
    const w = o.measured.wall;
    console.log(`  ${o.caseId} ${o.variant.padEnd(6)} wall dE00 ${w?.deltaE00 ?? "n/a"} (chromatic ${w?.chromaticDeltaE00 ?? "n/a"}, b* ${w?.bShift ?? "n/a"})${o.verifier ? ` kept ${o.verifier.keptRatio} roof ${o.verifier.roof} cam ${o.verifier.camera} photo ${o.verifier.photorealistic} added [${o.verifier.added.join("; ")}]` : " (legacy)"}`);
  } catch (e) {
    o.measureError = String(e.message).slice(0, 240);
    console.log(`  ${o.caseId} ${o.variant} measurement FAILED: ${o.measureError}`);
    if (String(e.message).startsWith("cap")) break;
  }
}
function srgb(hex) { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return labOf(r, g, b); }
function labOf(r, g, b) {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

// ------------------------------------------------------------------ report
const gitCommit = (() => { try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root }).toString().trim(); } catch { return "unknown"; } })();
writeFileSync(resolve(outDir, "phase4.json"), JSON.stringify({ stamp, gitCommit, visionModel, seed, guidance: GUIDANCE, endpoints: { baseline: kontext.id, swatch: MULTI_ENDPOINT, sam: SAM_MODEL }, ledger, refWall, outputs: outputs.map((o) => ({ ...o, file: o.file?.replace(/\\/g, "/") })) }, null, 2));
const esc = (s) => String(s).replace(/</g, "&lt;");
const cards = cases.map((c) => {
  const row = outputs.filter((o) => o.caseId === c.id && o.file).map((o) => {
    const name = `${c.id}_${o.variant}${o.legacy ? "_legacy" : ""}.jpg`;
    if (o.legacy) require("node:fs").copyFileSync(o.file, resolve(outDir, name));
    const w = o.measured?.wall;
    return `<figure><img src="${name}"><figcaption><b>${o.variant}</b>${o.legacy ? " (Phase 3, other lighting)" : ""} ${o.renderMs ? (o.renderMs / 1000).toFixed(0) + "s" : ""}<br><u>measured</u>: wall ΔE00 ${w?.deltaE00 ?? "n/a"} · chromatic ${w?.chromaticDeltaE00 ?? "n/a"} · b* ${w?.bShift ?? "n/a"}<br>${o.verifier ? `<u>model verifier (experimental)</u>: kept ${o.verifier.keptRatio} · roof ${o.verifier.roof} · camera ${o.verifier.camera} · photo ${o.verifier.photorealistic} · added: ${esc(o.verifier.added.join("; ") || "none")}` : ""}</figcaption></figure>`;
  }).join("");
  return `<section><h2>${c.id} ${esc(c.title)}</h2><div class="row"><figure><img src="${c.id}_source.jpg"><figcaption>source</figcaption></figure><figure><img src="${c.id}_reference.jpg"><figcaption>reference</figcaption></figure><figure><img src="${c.id}_board_labelled.png"><figcaption>swatch board</figcaption></figure>${row}</div></section>`;
}).join("");
for (const c of cases) {
  await sharp(abs(c.source)).rotate().flatten({ background: "#fff" }).resize({ width: 800, withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(resolve(outDir, `${c.id}_source.jpg`));
  await sharp(abs(c.reference)).rotate().flatten({ background: "#fff" }).resize({ width: 800, withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(resolve(outDir, `${c.id}_reference.jpg`));
}
writeFileSync(resolve(outDir, "report.html"), `<!doctype html><meta charset="utf-8"><title>Phase 4 ${stamp}</title><style>body{font:14px system-ui;margin:24px;background:#fafafa}.row{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start}figure{margin:0;width:300px}img{width:100%;border:1px solid #ccc}figcaption{font-size:12px;line-height:1.5}</style><h1>Phase 4: swatch boards (commit ${gitCommit})</h1><p>Measured numbers are deterministic. Model-verifier lines are experimental judgements, not ground truth.</p>${cards}`);
console.log(`\nDone. Spend ≈ $${total().toFixed(3)} (renders $${ledger.renders.toFixed(3)}, SAM $${ledger.sam.toFixed(3)}, vision $${ledger.vision.toFixed(3)}). Report: ${resolve(outDir, "report.html").replace(/\\/g, "/")}`);
