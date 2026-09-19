import type { RenderRoute } from "@renvia/types";

const STYLE_DESCRIPTIONS: Record<string, string> = {
  Photorealistic: "a photorealistic architectural visualization with physically accurate materials, lighting and shadows",
  "Vector sketch": "a clean architectural vector illustration with crisp, uniform linework and flat, minimal colour",
  "Watercolor sketch": "a loose architectural watercolour sketch with soft hand-painted washes over ink linework",
  "Watercolor collage": "a layered watercolour collage with painted paper textures, like an architectural presentation board",
};

const INFLUENCE_PHRASES: Record<number, string> = {
  1: "Apply the style subtly.",
  3: "Apply the style strongly.",
  4: "Apply the style as boldly as possible.",
};

const STRUCTURE_LOCK =
  "Keep the building's geometry, proportions, windows, doors, roofline and camera angle exactly as in the source image; " +
  "do not add, remove or move any structural elements.";

export interface EnginePromptOptions {
  /** The user's own prompt; may be empty. */
  prompt: string;
  style: string;
  route: RenderRoute;
  preserveStructure: boolean;
  /** 1 (subtle) – 4 (maximum). */
  influence: number;
}

/** Composes the model prompt; the user's raw prompt is stored separately on the render. */
export function buildEnginePrompt({ prompt, style, route, preserveStructure, influence }: EnginePromptOptions): string {
  const styleText = STYLE_DESCRIPTIONS[style] ?? STYLE_DESCRIPTIONS.Photorealistic!;
  const lead = {
    drawing: `Render the building in this architectural elevation drawing as ${styleText}.`,
    photo: `Re-render this building as ${styleText}.`,
    references:
      `Render the building from the first image as ${styleText}, ` +
      "matching the materials, colours, lighting and surroundings shown in the other images.",
  }[route];

  return [lead, preserveStructure ? STRUCTURE_LOCK : null, INFLUENCE_PHRASES[influence], prompt.trim() ? `Scene: ${prompt.trim()}` : null]
    .filter(Boolean)
    .join(" ");
}
