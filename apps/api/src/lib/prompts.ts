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
  /** photo = photo/3D massing, drawing = CAD/line elevation — each gets its own framing, with or without references. */
  sourceType: RenderSourceType;
  hasReferences: boolean;
  preserveStructure: boolean;
  /** 1 (subtle) – 4 (maximum). */
  influence: number;
}

/** Composes the model prompt; the user's raw prompt is stored separately on the render. */
export function buildEnginePrompt({
  prompt,
  style,
  sourceType,
  hasReferences,
  preserveStructure,
  influence,
}: EnginePromptOptions): string {
  const styleText = STYLE_DESCRIPTIONS[style] ?? STYLE_DESCRIPTIONS.Photorealistic!;
  const scene = prompt.trim() ? `Scene: ${prompt.trim()}` : null;

  if (hasReferences) {
    const level = Math.min(4, Math.max(1, Math.round(influence)));
    return [
      referenceLead(sourceType, styleText),
      preserveStructure ? REFERENCE_FORM_LOCK : REFERENCE_FORM_LOOSE,
      PROTOTYPE_BORROW[level],
      level >= 2 ? COLOUR_FIDELITY : null,
      scene,
    ]
      .filter(Boolean)
      .join(" ");
  }

  // Drawing keeps the CAD-elevation framing — it's the difference between the model following
  // the drawing's lines and guessing at them.
  const lead =
    sourceType === "drawing"
      ? `Render the building in this architectural elevation drawing as ${styleText}.`
      : `Re-render this building as ${styleText}.`;

  return [lead, preserveStructure ? STRUCTURE_LOCK : null, INFLUENCE_PHRASES[influence], scene].filter(Boolean).join(" ");
}

// With references the images play different roles: the first is the design (form, camera), the
// rest are the prototype (surfaces). Saying "match the references" without that split let the
// model pull the prototype's massing and viewpoint in too, most of all at high influence.
function referenceLead(sourceType: RenderSourceType, styleText: string): string {
  const design =
    sourceType === "drawing"
      ? "The first image is an architectural drawing of the building to render"
      : "The first image is the building to render";
  return (
    `${design}; render it as ${styleText}. ` +
    "The other images are the prototype: a reference for materials, finishes, colours and details only."
  );
}

const REFERENCE_FORM_LOCK =
  "Take the building's geometry, proportions, massing, roofline, window and door layout, and the camera angle and framing " +
  "exactly from the first image; do not add, remove or move any structural element. " +
  "Never copy the prototype's shape, layout or viewpoint.";

const REFERENCE_FORM_LOOSE =
  "Keep the first image's overall form, proportions and camera angle. Never copy the prototype's shape, layout or viewpoint.";

/** How much of the prototype's surface character to carry onto the design, by influence level. */
const PROTOTYPE_BORROW: Record<number, string> = {
  1: "Borrow only the prototype's general colour palette and mood; keep the first image's own materials where they are clear.",
  2: "Use the prototype's main facade materials and colours.",
  3:
    "Closely match the prototype's materials, finishes and colours, and carry over its architectural details " +
    "such as window frames, railings, soffits, trim and cladding patterns.",
  4:
    "Apply the prototype's materials, finishes, exact colours, architectural details and overall visual character " +
    "as completely as possible, including its lighting and landscaping, mapped onto the first image's form.",
};

// Image models drift colours warm (white renders come back cream or brown); spelling out the
// failure is what holds them to the prototype's palette.
const COLOUR_FIDELITY =
  "Reproduce the prototype's colours faithfully: white stays bright white, not cream, beige or brown; " +
  "do not warm, tint or recolour any surface.";

export interface EditPromptOptions {
  /** The user's own edit description; may be empty when references carry the intent. */
  prompt: string;
  edit: RenderEditSettings;
  hasReferences: boolean;
  /** The style the image being edited was rendered in; omitted or "Photorealistic" needs no hint. */
  style?: string;
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
export function buildEditPrompt({ prompt, edit, hasReferences, style }: EditPromptOptions): string {
  const subject = prompt.trim();
  // A non-default style on the image being edited would otherwise drift toward photoreal —
  // these models have no memory of how the source was rendered.
  const styleHint = style && style !== "Photorealistic" && STYLE_DESCRIPTIONS[style]
    ? `Keep this in ${STYLE_DESCRIPTIONS[style]}.`
    : "";

  if (edit.mode === "element" && hasReferences) {
    const target = subject || "the matching surfaces of the building";
    return [`Apply the material, texture and colour from the reference images to ${target}.`, KEEP_THE_REST, styleHint]
      .filter(Boolean)
      .join(" ");
  }

  if (edit.mode === "building" && hasReferences) {
    return [
      "Restyle the building in the architectural style of the reference images" + (subject ? `: ${subject}.` : "."),
      `Keep the building's geometry, proportions and camera angle. ${KEEP_THE_REST}`,
      styleHint,
    ]
      .filter(Boolean)
      .join(" ");
  }

  const instruction = {
    add: `Add ${subject} to the building.`,
    remove: `Remove ${subject} from the image and fill the area to match its surroundings.`,
    change: `Change ${subject}.`,
  }[edit.action ?? "change"];
  const referenceHint = hasReferences ? "Use the reference images as a guide." : "";
  return [asSentence(edit.mode === "prompt" || !edit.action ? subject : instruction), referenceHint, KEEP_THE_REST, styleHint]
    .filter(Boolean)
    .join(" ");
}
