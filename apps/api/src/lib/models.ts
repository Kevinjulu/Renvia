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
  /** Only supplied to the high-resolution export route. */
  upscaleFactor?: number;
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

// Multi-image editing with explicit image roles and source-composition retention. fal's
// launch price is lower, but budget at the published standard 1K rate so the global cap
// remains safe when promotional pricing ends.
const FLUX_3_EDIT: ModelSpec = {
  id: "blackforestlabs/flux-3/edit-image",
  costMicros: 48_000,
  buildInput: ({ imageUrl, referenceUrls, prompt, aspectRatio }) => ({
    image_urls: [imageUrl, ...referenceUrls],
    prompt,
    aspect_ratio: aspectRatio,
    resolution: "1k",
    enable_prompt_expansion: false,
    output_format: "jpeg",
  }),
};

/**
 * Dedicated strict-fidelity route.
 *
 * FAL rejects a request that combines EasyControl with its `reference_image_url` (its
 * "reference-only" mode). A source-only strict render can therefore use Canny spatial
 * control, but a strict render with a material reference must use the source image-to-image
 * path plus reference-only guidance instead. In that compatible branch the low denoise value
 * and the server-composed source-design contract retain the source building; the reference is
 * limited to its visual treatment by the prompt.
 */
const FLUX_GENERAL_FIDELITY: ModelSpec = {
  id: "fal-ai/flux-general/image-to-image",
  // fal bills this endpoint at $0.075 per rounded-up megapixel; Studio requests one 1K image.
  costMicros: 75_000,
  buildInput: ({ imageUrl, referenceUrls, prompt, aspectRatio, seed }) => {
    const materialReference = referenceUrls[0];
    return {
      image_url: imageUrl,
      prompt,
      // Reference-only guidance and EasyControl are mutually exclusive in FAL. With a
      // reference, lower denoise makes the source image the structural anchor; without one,
      // Canny gives the strongest available spatial lock.
      strength: materialReference ? 0.16 : 0.25,
      num_inference_steps: 28,
      guidance_scale: 3.5,
      ...(materialReference
        ? { reference_image_url: materialReference, reference_strength: 0.65 }
        : { easycontrols: [{ control_method_url: "canny", image_url: imageUrl, image_control_type: "spatial", scale: 1 }] }),
      ...(SDXL_IMAGE_SIZE[aspectRatio] ? { image_size: SDXL_IMAGE_SIZE[aspectRatio] } : {}),
      output_format: "jpeg",
      ...(seed !== undefined ? { seed } : {}),
    };
  },
};

// Bria preserves the existing architecture instead of generating a new design. The caller
// caps the result at a 4K or 8K long edge and supplies a factor no larger than 4x.
const BRIA_UPSCALE: ModelSpec = {
  id: "bria/increase-resolution",
  costMicros: 40_000,
  buildInput: ({ imageUrl, upscaleFactor }) => ({
    image_url: imageUrl,
    desired_increase: Math.round(upscaleFactor ?? 2),
    preserve_alpha: false,
    preserve_color: true,
    output_type: "png",
  }),
};

const MODELS: Record<RenderEngineMode, Record<RenderRoute, ModelSpec>> = {
  mock: { photo: MOCK, drawing: MOCK, references: MOCK, fidelity: MOCK, edit: MOCK, "edit-references": MOCK, upscale: MOCK },
  dev: {
    photo: LIGHTNING_SDXL,
    drawing: LIGHTNING_SDXL,
    references: LIGHTNING_SDXL,
    fidelity: LIGHTNING_SDXL,
    edit: LIGHTNING_SDXL,
    "edit-references": LIGHTNING_SDXL,
    upscale: BRIA_UPSCALE,
  },
  prod: {
    photo: KONTEXT_PRO,
    drawing: KONTEXT_PRO,
    references: FLUX_3_EDIT,
    fidelity: FLUX_GENERAL_FIDELITY,
    edit: KONTEXT_PRO,
    "edit-references": FLUX_3_EDIT,
    upscale: BRIA_UPSCALE,
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
