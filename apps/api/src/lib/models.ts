import type { RenderEngineMode, RenderRoute, RoutePrice } from "@renvia/types";
import type { ImageSize } from "./imageSize.js";

export interface ModelInput {
  /** fal-reachable URL of the building image being rendered or edited. */
  imageUrl: string;
  /** fal-reachable URLs of style/material reference images. */
  referenceUrls: string[];
  /** fal-reachable URL of the edit mask (white = area to change), for inpaint routes. */
  maskUrl: string | null;
  prompt: string;
  /** 1 (subtle) – 4 (maximum). */
  influence: number;
  preserveStructure: boolean;
  /** Target output size matching the source aspect ratio, when the source dimensions are known. */
  outputSize: ImageSize | null;
}

export interface ModelSpec {
  /** fal endpoint id, or "mock". */
  id: string;
  /** Cost in USD micros per image, or per started source megapixel when `perMegapixel` (from fal's pricing API). */
  costMicros: number;
  perMegapixel?: boolean;
  buildInput: (input: ModelInput) => Record<string, unknown>;
}

/** Picks the value for a 1–4 influence level. */
function byInfluence<T>(influence: number, values: readonly [T, T, T, T]): T {
  return values[Math.min(4, Math.max(1, Math.round(influence))) - 1]!;
}

const MOCK: ModelSpec = { id: "mock", costMicros: 0, buildInput: () => ({}) };

// Dev models: $0.00125/compute-second, ~1–2s per 4-step image — only for exercising the pipeline.
const LIGHTNING_SDXL: ModelSpec = {
  id: "fal-ai/fast-lightning-sdxl/image-to-image",
  costMicros: 3_000,
  buildInput: ({ imageUrl, prompt, influence, preserveStructure }) => ({
    image_url: imageUrl,
    prompt,
    strength: preserveStructure
      ? byInfluence(influence, [0.45, 0.55, 0.65, 0.75])
      : byInfluence(influence, [0.6, 0.7, 0.8, 0.9]),
    num_inference_steps: "4",
    preserve_aspect_ratio: true,
    format: "jpeg",
  }),
};

const LIGHTNING_SDXL_INPAINT: ModelSpec = {
  id: "fal-ai/fast-lightning-sdxl/inpainting",
  costMicros: 3_000,
  buildInput: ({ imageUrl, maskUrl, prompt, outputSize }) => ({
    image_url: imageUrl,
    mask_url: maskUrl,
    prompt,
    num_inference_steps: "4",
    // Defaults to a square output, which would squash non-square sources.
    image_size: outputSize ?? "landscape_4_3",
    format: "jpeg",
  }),
};

// $0.04/image. Instruction-based editing that keeps the input's composition.
const KONTEXT_PRO: ModelSpec = {
  id: "fal-ai/flux-pro/kontext",
  costMicros: 40_000,
  buildInput: ({ imageUrl, prompt, influence }) => ({
    image_url: imageUrl,
    prompt,
    guidance_scale: byInfluence(influence, [2.5, 3.5, 5, 7]),
    output_format: "jpeg",
  }),
};

// $0.04/MP, always generated at ~1 MP (outputSize), so billed per image here.
// The drawing is the canny control image, so line geometry is followed exactly.
const CANNY_CONTROL: ModelSpec = {
  id: "fal-ai/flux-control-lora-canny",
  costMicros: 40_000,
  buildInput: ({ imageUrl, prompt, influence, preserveStructure, outputSize }) => ({
    control_lora_image_url: imageUrl,
    control_lora_strength: preserveStructure ? 1 : 0.8,
    prompt,
    guidance_scale: byInfluence(influence, [2.5, 3.5, 5, 7]),
    num_inference_steps: 28,
    image_size: outputSize ?? "landscape_4_3",
    output_format: "jpeg",
  }),
};

// $0.0398/image. Multi-image editing: the building first, then the references.
const NANO_BANANA_EDIT: ModelSpec = {
  id: "fal-ai/nano-banana/edit",
  costMicros: 39_800,
  buildInput: ({ imageUrl, referenceUrls, prompt }) => ({
    image_urls: [imageUrl, ...referenceUrls],
    prompt,
    aspect_ratio: "auto",
    output_format: "jpeg",
  }),
};

// $0.05/MP of the source image. Regenerates only the masked area.
const FLUX_FILL_PRO: ModelSpec = {
  id: "fal-ai/flux-pro/v1/fill",
  costMicros: 50_000,
  perMegapixel: true,
  buildInput: ({ imageUrl, maskUrl, prompt }) => ({
    image_url: imageUrl,
    mask_url: maskUrl,
    prompt,
    output_format: "jpeg",
  }),
};

// $0.035/MP of the source image. Inpaints the masked area guided by one reference image.
const KONTEXT_INPAINT: ModelSpec = {
  id: "fal-ai/flux-kontext-lora/inpaint",
  costMicros: 35_000,
  perMegapixel: true,
  buildInput: ({ imageUrl, maskUrl, referenceUrls, prompt, influence }) => ({
    image_url: imageUrl,
    mask_url: maskUrl,
    reference_image_url: referenceUrls[0],
    prompt,
    strength: byInfluence(influence, [0.7, 0.8, 0.88, 0.95]),
    output_format: "jpeg",
  }),
};

const MOCK_ROUTES: Record<RenderRoute, ModelSpec> = {
  photo: MOCK,
  drawing: MOCK,
  references: MOCK,
  edit: MOCK,
  "edit-references": MOCK,
  inpaint: MOCK,
  "inpaint-reference": MOCK,
};

const MODELS: Record<RenderEngineMode, Record<RenderRoute, ModelSpec>> = {
  mock: MOCK_ROUTES,
  dev: {
    photo: LIGHTNING_SDXL,
    drawing: LIGHTNING_SDXL,
    references: LIGHTNING_SDXL,
    edit: LIGHTNING_SDXL,
    "edit-references": LIGHTNING_SDXL,
    inpaint: LIGHTNING_SDXL_INPAINT,
    "inpaint-reference": LIGHTNING_SDXL_INPAINT,
  },
  prod: {
    photo: KONTEXT_PRO,
    drawing: CANNY_CONTROL,
    references: NANO_BANANA_EDIT,
    edit: KONTEXT_PRO,
    "edit-references": NANO_BANANA_EDIT,
    inpaint: FLUX_FILL_PRO,
    "inpaint-reference": KONTEXT_INPAINT,
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

export function pricingFor(mode: RenderEngineMode): Record<RenderRoute, RoutePrice> {
  const entries = Object.entries(MODELS[mode]).map(([route, model]) => [
    route,
    { usd: model.costMicros / 1_000_000, perMegapixel: model.perMegapixel ?? false },
  ]);
  return Object.fromEntries(entries) as Record<RenderRoute, RoutePrice>;
}
