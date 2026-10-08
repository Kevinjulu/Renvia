// Experimental analysis modules: structure extraction, material extraction and a fidelity verifier.
// All three call fal's OpenRouter vision endpoint (the older any-llm/vision endpoint is deprecated).
// Every call returns its parsed JSON plus the raw text, token usage, reported cost and latency so the
// full pipeline cost and time can be added up honestly.
import { StructureAnalysis, MaterialAnalysis, FidelityCheck, MaterialObservation } from "./schemas.mjs";

export const VISION_ENDPOINT = "openrouter/router/vision";
export const PROMPT_VERSION = "p3.1";

const STRUCTURE_SYSTEM = `You are an architectural drawing reader. You describe ONLY what is drawn in the image, as a precise inventory a renderer must preserve.
Rules:
- Count only what you can count. If you cannot establish a number, use null. Never guess a count.
- Never invent an element that is not visible. If something is ambiguous, put it in "unknowns" and give the element low confidence.
- Give every element a short snake_case id, its position in the image (left/centre/right, upper/ground), and a literal description of how it is drawn (e.g. "clear frameless glass panels between steel posts", not a design opinion).
- Distinguish guardrail types carefully: glass_panel (clear glass infill), balustrade (vertical balusters), rail (thin horizontal rails only), solid_parapet.
- Do not describe materials or colours as if they were decided; the drawing is a line drawing. You may note cladding patterns that are drawn (e.g. vertical boards).
- Output a single JSON object and nothing else, no markdown.`;

const STRUCTURE_SHAPE = `JSON shape:
{
 "viewType": "orthographic_elevation|perspective|photo|other",
 "viewDescription": string,
 "storeys": {"count": integer|null, "confidence": "high|medium|low"},
 "roof": {"form": "flat|skillion|gable|hip|mixed|other|unknown", "description": string, "confidence": "high|medium|low"},
 "volumes": [Element], "openings": [Element], "guardrails": [Element], "facadeElements": [Element],
 "unknowns": [string],
 "preservationConstraints": [string]   // 4-8 plain sentences, derived only from this drawing
}
Element = {"id": snake_case, "kind": string, "location": string, "description": string, "count": integer|null, "confidence": "high|medium|low"}
kind values - volumes: main_volume|wing|block|other; openings: window|door|glazed_wall|garage_door|other; guardrails: glass_panel|balustrade|rail|solid_parapet|other; facadeElements: fins|columns|canopy|cantilever|stairs|balcony|chimney|downpipe|cladding_panel|pergola|other.`;

const MATERIAL_SYSTEM = `You are a materials and finishes analyst. You look at a REFERENCE photograph or render only to extract its surface finishes, colours, light and landscape. The reference is never a source of building shape.
Rules:
- Describe finishes of surfaces (walls, cladding, plinth, roof covering, window frames, doors, soffit/fascia, guardrail, paving) with material, colour name, an approximate hex, finish and texture.
- Be precise about white versus cream versus beige versus grey. Judge the colour of the surface itself, not the colour cast of the light on it; state in atmosphere.warmCast whether the light is warm/golden.
- Do NOT describe the building's shape, layout, proportions, number of storeys or window arrangement.
- Architectural features you notice (columns, arches, gables, balconies, dormers, towers, porticos) go ONLY into "structuralFeaturesSeen" so they can be forbidden later.
- If you cannot tell, say so in "unknowns" and lower the confidence. Do not invent.
- Output a single JSON object and nothing else, no markdown.`;

const MATERIAL_SHAPE = `JSON shape:
{
 "surfaces": [{"surface": "walls_primary|walls_secondary|cladding|base_plinth|roof_covering|window_frames|doors|soffit_fascia|guardrail|paving|other", "material": string, "colour": {"name": string, "hex": "#rrggbb"|null}, "finish": string|null, "confidence": "high|medium|low"}],
 "palette": [{"name": string, "hex": "#rrggbb"|null}],
 "atmosphere": {"timeOfDay": string, "sky": string, "lightQuality": string, "warmCast": boolean},
 "landscape": {"groundCover": string|null, "planting": string|null, "hardscape": string|null},
 "structuralFeaturesSeen": [string],
 "unknowns": [string]
}`;

const VERIFY_SYSTEM = `You are a strict architectural fidelity inspector. You are given image 1 (the SOURCE drawing) and image 2 (a RENDER that should be a faithful rendering of it), and a checklist of elements from the source.
For each checklist id decide: kept (clearly present, same form and position), changed (present but different type, material class, count or position - e.g. glass guardrail turned into thin rails), missing, or unclear. Be literal and sceptical.
List in addedElements any architectural element visible in the render that is NOT in the source (extra porch, columns, balcony, chimney, pitched roof, dormer, extra windows, carport...). Landscaping, sky, furniture and cars are not architectural elements; ignore them.
roof.status is "changed" if the roof form, overhang or edge differs from the source. camera.status is "changed" if the viewpoint or framing differs materially.
photorealistic is true only if the render looks like a photograph of a real building, not a line drawing, flat illustration or CG diagram.
wallColourObserved: the colour of the main walls as they appear (e.g. "bright white", "cream", "light grey").
Output a single JSON object and nothing else, no markdown.`;

const VERIFY_SHAPE = `JSON shape:
{"checks":[{"id": string, "status": "kept|changed|missing|unclear", "note": string}], "addedElements":[string], "roof":{"status":"kept|changed","note":string}, "camera":{"status":"kept|changed","note":string}, "photorealistic": boolean, "wallColourObserved": string}`;

function extractJson(text) {
  const cleaned = String(text).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in model output");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** One validated call, with a single repair retry that feeds the validation error back. */
async function callValidated(fal, { model, system, prompt, imageUrls, schema, maxTokens = 6000 }) {
  const started = Date.now();
  let usageCost = 0;
  let usageTokens = 0;
  let lastError = null;
  let raw = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const retryNote = lastError ? `\n\nYour previous answer was invalid: ${lastError}. Return only the corrected JSON object.` : "";
    const { data } = await fal.subscribe(VISION_ENDPOINT, {
      input: { model, system_prompt: system, prompt: prompt + retryNote, image_urls: imageUrls, temperature: 0, max_tokens: maxTokens },
      logs: false,
    });
    raw = data.output ?? "";
    usageCost += Number(data.usage?.cost ?? 0);
    usageTokens += Number(data.usage?.total_tokens ?? 0);
    try {
      const parsed = schema.parse(extractJson(raw));
      return { data: parsed, raw, ms: Date.now() - started, costUsd: usageCost, tokens: usageTokens, attempts: attempt + 1 };
    } catch (error) {
      lastError = String(error?.issues ? JSON.stringify(error.issues.slice(0, 4)) : error?.message ?? error).slice(0, 500);
    }
  }
  throw new Error(`vision output failed validation twice: ${lastError}\n--- raw ---\n${raw.slice(0, 800)}`);
}

export const analyzeStructure = (fal, model, imageUrl) =>
  callValidated(fal, {
    model,
    system: STRUCTURE_SYSTEM,
    prompt: `Inventory the building drawn in this image so a renderer can preserve it exactly.\n\n${STRUCTURE_SHAPE}`,
    imageUrls: [imageUrl],
    schema: StructureAnalysis,
  });

export const analyzeMaterials = (fal, model, imageUrl) =>
  callValidated(fal, {
    model,
    system: MATERIAL_SYSTEM,
    prompt: `Extract the finishes, colours, light and landscape of this reference. Do not describe its building's shape.\n\n${MATERIAL_SHAPE}`,
    imageUrls: [imageUrl],
    schema: MaterialAnalysis,
  });

export const verifyFidelity = (fal, model, sourceUrl, resultUrl, structure) => {
  const ids = [
    "roof",
    ...structure.volumes.map((e) => e.id),
    ...structure.openings.map((e) => e.id),
    ...structure.guardrails.map((e) => e.id),
    ...structure.facadeElements.map((e) => e.id),
  ];
  const lines = [...structure.volumes, ...structure.openings, ...structure.guardrails, ...structure.facadeElements]
    .map((e) => `- ${e.id} (${e.kind}, ${e.location}${e.count ? `, count ${e.count}` : ""}): ${e.description}`)
    .join("\n");
  return callValidated(fal, {
    model,
    system: VERIFY_SYSTEM,
    prompt: `Checklist (ids to judge; "roof" is judged separately):\n${lines}\n\nRoof in source: ${structure.roof.form} - ${structure.roof.description}\n\n${VERIFY_SHAPE}`,
    imageUrls: [sourceUrl, resultUrl],
    schema: FidelityCheck,
  }).then((r) => ({ ...r, checklistIds: ids }));
};

const INSPECT_SYSTEM = `You inspect a rendered building and report what you actually see on named surface roles. Judge the colour of the surface itself, not the light falling on it (a white wall in warm light is still white; say so in colourName, and estimate the hex of the surface under neutral light). Be literal. If a role is not visible, set visible=false. Output a single JSON object and nothing else.`;

/** Experimental: what colour/material does each role actually have in the render? (model judgement, not ground truth) */
export const inspectMaterials = (fal, model, resultUrl, roles) =>
  callValidated(fal, {
    model,
    system: INSPECT_SYSTEM,
    prompt: `Report these surface roles as rendered: ${roles.join(", ")}.\nJSON shape: {"roles":[{"role": string (one of the requested), "visible": boolean, "colourName": string, "hex": "#rrggbb"|null, "material": string}]}`,
    imageUrls: [resultUrl],
    schema: MaterialObservation,
    maxTokens: 1500,
  });
