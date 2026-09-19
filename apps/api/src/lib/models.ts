import type { RenderEngineMode, RenderRoute } from "@renvia/types";
import type { ImageSize } from "./imageSize.js";

export interface ModelInput {
  /** fal-reachable URL of the building image being rendered. */
  imageUrl: string;
  /** fal-reachable URLs of style/material reference images. */
  referenceUrls: string[];
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
  /** Per-image cost in USD micros, from fal's pricing API (1 MP tier for megapixel-billed models). */
  costMicros: number;
  buildInput: (input: ModelInput) => Record<string, unknown>;
}

/** Picks the value for a 1–4 influence level. */
function byInfluence<T>(influence: number, values: readonly [T, T, T, T]): T {
  return values[Math.min(4, Math.max(1, Math.round(influence))) - 1]!;
}

const MOCK: ModelSpec = { id: "mock", costMicros: 0, buildInput: () => ({}) };

// $0.00125/compute-second, ~1–2s per 4-step image — only for exercising the pipeline.
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

// $0.04/MP. The drawing is the canny control image, so line geometry is followed exactly.
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

const MODELS: Record<RenderEngineMode, Record<RenderRoute, ModelSpec>> = {
  mock: { photo: MOCK, drawing: MOCK, references: MOCK },
  dev: { photo: LIGHTNING_SDXL, drawing: LIGHTNING_SDXL, references: LIGHTNING_SDXL },
  prod: { photo: KONTEXT_PRO, drawing: CANNY_CONTROL, references: NANO_BANANA_EDIT },
};

export function modelFor(mode: RenderEngineMode, route: RenderRoute): ModelSpec {
  return MODELS[mode][route];
}

export function modelById(id: string | null): ModelSpec | undefined {
  return Object.values(MODELS)
    .flatMap((routes) => Object.values(routes))
    .find((model) => model.id === id);
}

export function costByRouteUsd(mode: RenderEngineMode): Record<RenderRoute, number> {
  const routes = MODELS[mode];
  return {
    photo: routes.photo.costMicros / 1_000_000,
    drawing: routes.drawing.costMicros / 1_000_000,
    references: routes.references.costMicros / 1_000_000,
  };
}
