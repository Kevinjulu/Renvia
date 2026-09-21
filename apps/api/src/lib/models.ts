import type { AspectRatio, RenderEngineMode, RenderRoute } from "@renvia/types";

export interface ModelInput {
  /** fal-reachable URL of the building image being rendered or edited. */
  imageUrl: string;
  /** fal-reachable URLs of style/material reference images. */
  referenceUrls: string[];
  prompt: string;
  /** 1 (subtle) – 4 (maximum). */
  influence: number;
  preserveStructure: boolean;
  /** "auto" leaves the model's own default (usually: match the input image). */
  aspectRatio: AspectRatio;
  /** Reproduces (or nudges from) a previous result when set; a fresh random seed otherwise. */
  seed?: number;
}

export interface ModelSpec {
  /** fal endpoint id, or "mock". */
  id: string;
  /** Cost per image in USD micros, from fal's pricing API. */
  costMicros: number;
  buildInput: (input: ModelInput) => Record<string, unknown>;
}

/** Picks the value for a 1–4 influence level. */
function byInfluence<T>(influence: number, values: readonly [T, T, T, T]): T {
  return values[Math.min(4, Math.max(1, Math.round(influence))) - 1]!;
}

const MOCK: ModelSpec = { id: "mock", costMicros: 0, buildInput: () => ({}) };

/** fast-lightning-sdxl's ImageSize presets for each fixed ratio; "auto" omits image_size entirely. */
const SDXL_IMAGE_SIZE: Partial<Record<AspectRatio, string>> = {
  "1:1": "square_hd",
  "16:9": "landscape_16_9",
  "4:3": "landscape_4_3",
  "3:4": "portrait_4_3",
  "9:16": "portrait_16_9",
};

// $0.00125/compute-second, ~1–2s per 4-step image — only for exercising the pipeline.
const LIGHTNING_SDXL: ModelSpec = {
  id: "fal-ai/fast-lightning-sdxl/image-to-image",
  costMicros: 3_000,
  buildInput: ({ imageUrl, prompt, influence, preserveStructure, aspectRatio, seed }) => ({
    image_url: imageUrl,
    prompt,
    strength: preserveStructure
      ? byInfluence(influence, [0.45, 0.55, 0.65, 0.75])
      : byInfluence(influence, [0.6, 0.7, 0.8, 0.9]),
    num_inference_steps: "4",
    // A fixed ratio asks for a specific canvas; "auto" instead keeps the source's own shape.
    ...(SDXL_IMAGE_SIZE[aspectRatio] ? { image_size: SDXL_IMAGE_SIZE[aspectRatio] } : { preserve_aspect_ratio: true }),
    format: "jpeg",
    ...(seed !== undefined ? { seed } : {}),
  }),
};

// $0.04/image. Instruction-based editing that keeps the input's composition. In the
// phase-5 comparison it beat canny ControlNet on line drawings (photoreal rather than a
// flat 3D look) and FLUX Fill on masked edits (paired with the masked composite).
const KONTEXT_PRO: ModelSpec = {
  id: "fal-ai/flux-pro/kontext",
  costMicros: 40_000,
  buildInput: ({ imageUrl, prompt, influence, aspectRatio, seed }) => ({
    image_url: imageUrl,
    prompt,
    guidance_scale: byInfluence(influence, [2.5, 3.5, 5, 7]),
    output_format: "jpeg",
    // No "auto" value on this endpoint — omitting it keeps the source's own aspect ratio.
    ...(aspectRatio !== "auto" ? { aspect_ratio: aspectRatio } : {}),
    ...(seed !== undefined ? { seed } : {}),
  }),
};

// $0.0398/image. Multi-image editing: the building first, then the references. Rendered
// the line drawing almost exactly as the real building when given its photo as reference.
const NANO_BANANA_EDIT: ModelSpec = {
  id: "fal-ai/nano-banana/edit",
  costMicros: 39_800,
  buildInput: ({ imageUrl, referenceUrls, prompt, aspectRatio, seed }) => ({
    image_urls: [imageUrl, ...referenceUrls],
    prompt,
    aspect_ratio: aspectRatio,
    output_format: "jpeg",
    ...(seed !== undefined ? { seed } : {}),
  }),
};

const MODELS: Record<RenderEngineMode, Record<RenderRoute, ModelSpec>> = {
  mock: { photo: MOCK, drawing: MOCK, references: MOCK, edit: MOCK, "edit-references": MOCK },
  dev: {
    photo: LIGHTNING_SDXL,
    drawing: LIGHTNING_SDXL,
    references: LIGHTNING_SDXL,
    edit: LIGHTNING_SDXL,
    "edit-references": LIGHTNING_SDXL,
  },
  prod: {
    photo: KONTEXT_PRO,
    drawing: KONTEXT_PRO,
    references: NANO_BANANA_EDIT,
    edit: KONTEXT_PRO,
    "edit-references": NANO_BANANA_EDIT,
  },
};

export function modelFor(mode: RenderEngineMode, route: RenderRoute): ModelSpec {
  return MODELS[mode][route];
}

export function modelById(id: string | null): ModelSpec | undefined {
  return Object.values(MODELS)
    .flatMap((routes) => Object.values(routes))
    .find((model) => model.id === id);
}

export function pricingFor(mode: RenderEngineMode): Record<RenderRoute, number> {
  const entries = Object.entries(MODELS[mode]).map(([route, model]) => [route, model.costMicros / 1_000_000]);
  return Object.fromEntries(entries) as Record<RenderRoute, number>;
}

/** Read-only model map for the admin Settings console. */
export function modelsFor(mode: RenderEngineMode): { route: RenderRoute; modelId: string; costUsd: number }[] {
  return (Object.keys(MODELS[mode]) as RenderRoute[]).map((route) => {
    const model = MODELS[mode][route];
    return { route, modelId: model.id, costUsd: model.costMicros / 1_000_000 };
  });
}
