import type { RenderEditSettings, RenderSourceType } from "@renvia/types";

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
  route: RenderSourceType | "references";
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

export interface EditPromptOptions {
  /** The user's own edit description; may be empty when references carry the intent. */
  prompt: string;
  edit: RenderEditSettings;
  hasReferences: boolean;
}

const KEEP_THE_REST = "Keep everything else in the image exactly as it is.";

/** Capitalizes and terminates free text so it reads as its own sentence next to others. */
function asSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const capitalized = trimmed[0]!.toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

/**
 * Composes the model prompt for an Edit-tab job. Selection edits use the same instruction
 * prompt — only the selected area of the result is kept, so the model needn't know about it.
 */
export function buildEditPrompt({ prompt, edit, hasReferences }: EditPromptOptions): string {
  const subject = prompt.trim();

  if (edit.mode === "element" && hasReferences) {
    const target = subject || "the matching surfaces of the building";
    return `Apply the material, texture and colour from the reference images to ${target}. ${KEEP_THE_REST}`;
  }

  if (edit.mode === "building" && hasReferences) {
    return (
      "Restyle the building in the architectural style of the reference images" +
      (subject ? `: ${subject}. ` : ". ") +
      `Keep the building's geometry, proportions and camera angle. ${KEEP_THE_REST}`
    );
  }

  const instruction = {
    add: `Add ${subject} to the building.`,
    remove: `Remove ${subject} from the image and fill the area to match its surroundings.`,
    change: `Change ${subject}.`,
  }[edit.action ?? "change"];
  const referenceHint = hasReferences ? "Use the reference images as a guide." : "";
  return [asSentence(edit.mode === "prompt" || !edit.action ? subject : instruction), referenceHint, KEEP_THE_REST]
    .filter(Boolean)
    .join(" ");
}
