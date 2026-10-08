// Builds a BLIND human-annotation pack of ~30 renders from the benchmark results.
//
//   node tests/render-benchmark/calibration/pack.mjs [--count 30] [--seed 7]
//
// Output (git-ignored): results/calibration-pack/
//   annotate.html            self-contained annotation tool (give this folder to annotators)
//   images/, sources/, refs/ blind-named images; approach names never appear in annotator-visible files
//   key.json                 PRIVATE mapping blind id -> case/approach/file + the model verifier's judgement. Do not share.
// Sampling is stratified by case, then by approach, with a seeded shuffle; at least one render per approach is included,
// and 10 of the 30 are repeated (as new blind ids) so intra-annotator consistency can be measured.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bench = resolve(here, "..");
const root = resolve(bench, "../..");
const require = createRequire(resolve(root, "apps/api/package.json"));
const sharp = require("sharp");

const args = process.argv.slice(2);
const option = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const COUNT = Number(option("count", "30"));
const REPEATS = Math.round(COUNT / 3);
let rngState = Number(option("seed", "7")) >>> 0;
const rand = () => { rngState = (rngState * 1664525 + 1013904223) >>> 0; return rngState / 2 ** 32; };
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

const results = resolve(bench, "results");
const latest = (prefix) => readdirSync(results).filter((d) => d.startsWith(prefix)).sort().pop();
const candidates = [];

const p3 = latest("phase3-");
if (p3) {
  const run = JSON.parse(readFileSync(resolve(results, p3, "run3.json"), "utf8"));
  for (const o of run.outputs) if (o.file && o.verify) candidates.push({ phase: "phase3", caseId: o.caseId, approach: o.approach, file: o.file, verifier: { roof: o.verify.roof.status, camera: o.verify.camera.status, photorealistic: o.verify.photorealistic, added: o.verify.addedElements, changed: o.verify.changed, missing: o.verify.missing, wall: o.verify.wallColourObserved } });
}
const p4 = latest("phase4-");
if (p4 && existsSync(resolve(results, p4, "phase4.json"))) {
  const run = JSON.parse(readFileSync(resolve(results, p4, "phase4.json"), "utf8"));
  for (const o of run.outputs) if (o.file && o.verifier && !o.legacy) candidates.push({ phase: "phase4", caseId: o.caseId, approach: o.variant, file: o.file, verifier: { roof: o.verifier.roof, camera: o.verifier.camera, photorealistic: o.verifier.photorealistic, added: o.verifier.added, changed: o.verifier.changed, missing: o.verifier.missing, wall: o.verifier.wallColourObserved } });
}
if (!candidates.length) { console.error("No verified renders found. Run phase3.mjs / phase4.mjs first."); process.exit(1); }

// stratified pick: round-robin over cases, preferring approaches not yet represented
const byCase = new Map();
for (const c of shuffle(candidates)) (byCase.get(c.caseId) ?? byCase.set(c.caseId, []).get(c.caseId)).push(c);
const picked = [];
const seenApproach = new Map();
while (picked.length < COUNT && [...byCase.values()].some((l) => l.length)) {
  for (const [, list] of byCase) {
    if (!list.length || picked.length >= COUNT) continue;
    list.sort((a, b) => (seenApproach.get(a.approach) ?? 0) - (seenApproach.get(b.approach) ?? 0));
    const next = list.shift();
    seenApproach.set(next.approach, (seenApproach.get(next.approach) ?? 0) + 1);
    picked.push(next);
  }
}
const repeats = shuffle(picked).slice(0, REPEATS).map((p) => ({ ...p, repeatOf: true }));
const items = shuffle([...picked, ...repeats]).map((p, i) => ({ ...p, id: `R${String(i + 1).padStart(2, "0")}` }));

const out = resolve(results, "calibration-pack");
for (const d of ["images", "sources", "refs"]) mkdirSync(resolve(out, d), { recursive: true });
const manifest = JSON.parse(readFileSync(resolve(bench, "manifest.json"), "utf8"));
const extra = JSON.parse(readFileSync(resolve(bench, "cases3.json"), "utf8"));
const caseDefs = new Map([...manifest.cases, ...extra.cases].map((c) => [c.id, c]));
const blindCase = new Map([...new Set(items.map((i) => i.caseId))].sort().map((id, k) => [id, `S${k + 1}`]));

for (const [id, label] of blindCase) {
  const def = caseDefs.get(id);
  await sharp(resolve(root, def.source)).rotate().flatten({ background: "#fff" }).resize({ width: 1400, withoutEnlargement: true }).jpeg({ quality: 90 }).toFile(resolve(out, "sources", `${label}.jpg`));
  await sharp(resolve(root, def.reference)).rotate().flatten({ background: "#fff" }).resize({ width: 1000, withoutEnlargement: true }).jpeg({ quality: 90 }).toFile(resolve(out, "refs", `${label}.jpg`));
}
for (const it of items) await sharp(it.file).rotate().resize({ width: 1400, withoutEnlargement: true }).jpeg({ quality: 90 }).toFile(resolve(out, "images", `${it.id}.jpg`));

writeFileSync(resolve(out, "key.json"), JSON.stringify(items.map(({ id, caseId, approach, phase, file, repeatOf, verifier }) => ({ id, caseId, blindCase: blindCase.get(caseId), approach, phase, file, repeatOf: !!repeatOf, verifier })), null, 2));
const publicItems = items.map((it) => ({ id: it.id, source: `sources/${blindCase.get(it.caseId)}.jpg`, ref: `refs/${blindCase.get(it.caseId)}.jpg`, image: `images/${it.id}.jpg` }));

const html = `<!doctype html><meta charset="utf-8"><title>Render annotation</title>
<style>body{font:14px system-ui;margin:0;background:#f6f6f6;color:#111}header{position:sticky;top:0;background:#fff;border-bottom:1px solid #ddd;padding:10px 16px;display:flex;gap:12px;align-items:center;z-index:2}
main{display:grid;grid-template-columns:1fr 360px;gap:16px;padding:16px}.imgs{display:grid;grid-template-columns:1fr 1fr;gap:10px}.imgs figure{margin:0}.imgs img{width:100%;border:1px solid #ccc;background:#fff}
.big{grid-column:1/3}fieldset{border:1px solid #ccc;border-radius:6px;margin:0 0 10px;padding:8px 10px;background:#fff}legend{font-weight:600;padding:0 4px}label{display:block;margin:3px 0}
textarea,input[type=text],select{width:100%;box-sizing:border-box}button{padding:6px 12px}small{color:#555}</style>
<header><b id="pos"></b><button id="prev">&larr; Prev</button><button id="next">Next &rarr;</button>Annotator id: <input id="who" type="text" style="width:120px" placeholder="initials"><button id="export">Export JSON</button><small id="done"></small></header>
<main><div class="imgs"><figure><img id="src"><figcaption>SOURCE drawing (the design that must be preserved)</figcaption></figure><figure><img id="ref"><figcaption>REFERENCE (finishes only)</figcaption></figure><figure class="big"><img id="img"><figcaption>RENDER to judge</figcaption></figure></div>
<form id="f"><fieldset><legend>1 Structure</legend>
<label>Roof form and edges as the source <select name="roof"><option value="">-</option><option>kept</option><option>changed</option></select></label>
<label>Camera / viewpoint / framing <select name="camera"><option value="">-</option><option>kept</option><option>changed</option></select></label>
<label>Openings changed, moved, merged or missing (count) <input name="openingsWrong" type="number" min="0" value="0"></label>
<label>Architectural elements ADDED that the source lacks (count; landscape, sky, furniture, cars do not count) <input name="addedCount" type="number" min="0" value="0"></label>
<label>Which added elements? <input name="addedText" type="text"></label>
<label>Guardrail (if the source has one) <select name="guardrail"><option value="">-</option><option>kept</option><option>changed</option><option>not applicable</option></select></label></fieldset>
<fieldset><legend>2 Look</legend><label>Reads as a photograph of a real building <select name="photo"><option value="">-</option><option>yes</option><option>no</option></select></label></fieldset>
<fieldset><legend>3 Material and colour (compare with REFERENCE)</legend>
<label>Main wall colour vs reference <select name="wallColour"><option value="">-</option><option>same</option><option>slightly off</option><option>clearly off</option></select></label>
<label>Main walls look <select name="wallName"><option value="">-</option><option>bright white</option><option>off-white</option><option>cream/beige</option><option>grey</option><option>other</option></select></label>
<label>Reference walls look <select name="refWallName"><option value="">-</option><option>bright white</option><option>off-white</option><option>cream/beige</option><option>grey</option><option>other</option></select></label>
<label>Materials on the right surfaces (walls / frames / doors / cladding) <select name="assignment"><option value="">-</option><option>all correct</option><option>one wrong</option><option>several wrong</option></select></label></fieldset>
<fieldset><legend>4 Verdict</legend><label>Would you deliver this to an architect as a faithful render of the source? <select name="verdict"><option value="">-</option><option>accept</option><option>reject</option></select></label>
<label>Confidence <select name="confidence"><option value="">-</option><option>1 unsure</option><option>2 fairly sure</option><option>3 certain</option></select></label>
<label>Notes <textarea name="notes" rows="3"></textarea></label></fieldset></form></main>
<script>
const items=${JSON.stringify(publicItems)};let i=0;const store=JSON.parse(localStorage.getItem("calib")||"{}");
const f=document.getElementById("f");const $=id=>document.getElementById(id);
function show(){const it=items[i];$("src").src=it.source;$("ref").src=it.ref;$("img").src=it.image;$("pos").textContent=it.id+"  ("+(i+1)+"/"+items.length+")";
const a=store[it.id]||{};for(const el of f.elements){if(!el.name)continue;el.value=a[el.name]??(el.type==="number"?"0":"")}
$("done").textContent=Object.values(store).filter(s=>s.verdict).length+" done"}
function save(){const it=items[i];store[it.id]=Object.fromEntries([...f.elements].filter(e=>e.name).map(e=>[e.name,e.value]));localStorage.setItem("calib",JSON.stringify(store));$("done").textContent=Object.values(store).filter(s=>s.verdict).length+" done"}
f.addEventListener("input",save);$("prev").onclick=()=>{save();i=Math.max(0,i-1);show()};$("next").onclick=()=>{save();i=Math.min(items.length-1,i+1);show()};
$("export").onclick=()=>{save();const who=$("who").value.trim()||"annotator";const blob=new Blob([JSON.stringify({annotator:who,exportedAt:new Date().toISOString(),labels:store},null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="annotations-"+who+".json";a.click()};
show();</script>`;
writeFileSync(resolve(out, "annotate.html"), html);
console.log(`Calibration pack: ${items.length} blind items (${picked.length} unique + ${repeats.length} repeats) from ${candidates.length} verified renders across ${blindCase.size} cases.\nFolder: ${out.replace(/\\/g, "/")}\nGive annotators the folder WITHOUT key.json.`);
const per = {};
for (const it of picked) per[it.approach] = (per[it.approach] ?? 0) + 1;
console.log("Approach mix (private):", JSON.stringify(per));
