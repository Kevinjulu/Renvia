import type { RenderEditSettings, RenderSourceType } from "@renvia/types";

const STYLE_DESCRIPTIONS: Record<string, string> = {
  Photorealistic: "a photorealistic architectural visualization with physically accurate materials, lighting and shadows",
  "Vector sketch": "a clean architectural vector illustration with crisp, uniform linework and flat, minimal colour",
  "Watercolor sketch": "a loose architectural watercolour sketch with soft hand-painted washes over ink linework",
  "Watercolor collage": "a layered watercolour collage with painted paper textures, like an architectural presentation board",
};

const INFLUENCE_PHRASES: Record<number, string> = {
  1: "Apply the style subtly.",
  2: "Apply the style moderately.",
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
      // Reference renders are always source-led. The engine enforces this too, but keeping
      // the branch here makes this contract explicit for callers outside the normal route.
      REFERENCE_FORM_LOCK,
      PROTOTYPE_BORROW[level],
      level >= 2 ? COLOUR_FIDELITY : null,
      scene,
      // The user's scene direction comes last, so repeat the contract after it. This keeps a
      // visually strong reference or an enthusiastic prompt from becoming a request to redraw.
      REFERENCE_FORM_LOCK,
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
// rest are prototype swatches (surfaces). Saying "match the references" without that split let
// the model pull the prototype's massing and viewpoint in too, most of all at high influence.
function referenceLead(sourceType: RenderSourceType, styleText: string): string {
  const design =
    sourceType === "drawing"
      ? "The first image is an architectural drawing of the building to render"
      : "The first image is the building to render";
  return (
    `${design}; render it as ${styleText}. ` +
    "Every later image is a prototype swatch board for materials, finishes, colours, lighting and landscape only, never a building to copy."
  );
}

const REFERENCE_FORM_LOCK =
  "NON-NEGOTIABLE SOURCE DESIGN CONTRACT: Treat the first image as the fixed building and fixed camera. Preserve its exact " +
  "silhouette, footprint, massing, floor count, proportions, roof shape and ridges, eaves, windows, doors, balconies, garages, " +
  "porches, gazebos, openings, camera angle and framing. Map prototype colours and surface finishes only onto the corresponding " +
  "existing source surfaces. Do not add, remove, resize, relocate or replace any architectural element. Never copy, blend with, " +
  "interpolate toward, or match a prototype's shape, layout, camera angle, perspective or composition.";

/** How much of the prototype's surface character to carry onto the design, by influence level. */
const PROTOTYPE_BORROW: Record<number, string> = {
  1: "Borrow only the prototype's general colour palette and mood; keep the first image's own materials where they are clear.",
  2: "Use the prototype's main facade materials and colours.",
  3:
    "Closely match the prototype's materials, finishes, colours and surface treatment, including cladding pattern, trim finish, " +
    "frame colour, railing finish and soffit treatment, only where the first image already has a matching surface.",
  4:
    "Apply the prototype's materials, finishes, exact colours and visual character as completely as possible, including compatible " +
    "lighting, paving and landscaping, but never its structural features. If a prototype feature needs a different opening, roof, " +
    "volume, balcony, column, wall or camera position, omit that feature rather than changing the first image.",
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
  /** A brush/rectangle/polygon/magic selection is targeting part of the image, not the whole thing. */
  hasSelection?: boolean;
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
 * Composes the model prompt for an Edit-tab job. A selection edit is already sent a cropped
 * close-up of just that region (see engine.ts) — only its result is composited back — but the
 * catch-all branch below still names it explicitly, since a short text cue costs nothing and
 * keeps the model from mistaking the crop for the whole building.
 */
export function buildEditPrompt({ prompt, edit, hasReferences, hasSelection, style }: EditPromptOptions): string {
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
    // No styleHint here — restyling via reference means leaving the current style behind,
    // which a "keep this in ..." instruction for that same current style would contradict.
    return [
      "Restyle the building in the architectural style of the reference images" + (subject ? `: ${subject}.` : "."),
      `Keep the building's geometry, proportions and camera angle. ${KEEP_THE_REST}`,
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
  // This is already a close-up crop of just the selected region (see engine.ts), but saying
  // so in words too keeps the model from second-guessing what it's looking at.
  const selectionLead = hasSelection ? "This is a close-up of the selected part of the building." : "";
  return [
    selectionLead,
    asSentence(edit.mode === "prompt" || !edit.action ? subject : instruction),
    referenceHint,
    KEEP_THE_REST,
    styleHint,
  ]
    .filter(Boolean)
    .join(" ");
}
