import {
  editMethodFor,
  MAX_EDIT_REFERENCE_NOTE_CHARS,
  type EditEnvironment,
  type EditMethod,
  type EditReference,
  type EditReferenceTarget,
  type EditSeason,
  type EditStyle,
  type EditTimeOfDay,
  type EditWeather,
  type FacadeMaterial,
  type PromptRepairResponse,
  type ProtectedGeometryFeature,
  type RenderEditSettings,
  type RenderSourceType,
} from "@renvia/types";

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
  /** Strict mode is a user-reviewed source-design contract, not a promise of model determinism. */
  strictFidelity?: boolean;
  protectedFeatures?: ProtectedGeometryFeature[];
}

const STRUCTURAL_CHANGE = /\b(add|remove|move|relocate|replace|resize|change|redesign|rebuild|extend|rotate|shift|alter|make)\b[\s\S]{0,100}\b(roof|roofline|ridge|eave|window|windows|door|doors|opening|openings|balcony|garage|porch|gazebo|floor|storey|story|massing|volume|footprint|silhouette|facade|façade|camera|view|perspective|angle|framing)\b/i;
const PROTOTYPE_COPY = /\b(copy|match|use|borrow|take)\b[\s\S]{0,80}\b(building|house|architecture|shape|layout|perspective|camera|composition)\b/i;

/**
 * Makes a short free-text direction safe for a source-locked reference render. It is
 * deliberately deterministic: users can preview exactly what will be sent, and no second
 * AI model gets to reinterpret their architecture. Non-structural material, light and
 * landscape direction is retained verbatim.
 */
export function repairReferencePrompt(prompt: string): PromptRepairResponse {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (!normalized) return { prompt: "", repairs: [], blocked: [] };

  const sentences = normalized.match(/[^.!?]+[.!?]*/g) ?? [normalized];
  const safe: string[] = [];
  const blocked: string[] = [];
  for (const sentence of sentences) {
    const direction = sentence.trim();
    if (!direction) continue;
    if (STRUCTURAL_CHANGE.test(direction) || PROTOTYPE_COPY.test(direction)) {
      blocked.push(direction.replace(/[.!?]+$/, ""));
    } else {
      safe.push(direction.replace(/[.!?]+$/, ""));
    }
  }

  const repaired = safe.join(". ");
  const repairs: string[] = [];
  if (repaired !== normalized.replace(/[.!?]+$/g, "")) repairs.push("Removed requests that would redesign the source building.");
  if (repaired && !/[.!?]$/.test(repaired)) repairs.push("Normalized the direction into a concise rendering brief.");
  return { prompt: repaired, repairs, blocked };
}

/** Composes the model prompt; the user's raw prompt is stored separately on the render. */
export function buildEnginePrompt({
  prompt,
  style,
  sourceType,
  hasReferences,
  preserveStructure,
  influence,
  strictFidelity = false,
  protectedFeatures = ["silhouette", "roof", "openings", "massing", "camera"],
}: EnginePromptOptions): string {
  const styleText = STYLE_DESCRIPTIONS[style] ?? STYLE_DESCRIPTIONS.Photorealistic!;
  const scene = prompt.trim() ? `Scene: ${prompt.trim()}` : null;

  if (hasReferences) {
    const level = Math.min(4, Math.max(1, Math.round(influence)));
    const repaired = repairReferencePrompt(prompt);
    const repairedScene = repaired.prompt ? `Scene: ${repaired.prompt}` : null;
    return [
      referenceLead(sourceType, styleText),
      // Reference renders are always source-led. The engine enforces this too, but keeping
      // the branch here makes this contract explicit for callers outside the normal route.
      REFERENCE_FORM_LOCK,
      PROTOTYPE_BORROW[level],
      level >= 2 ? COLOUR_FIDELITY : null,
      strictFidelity ? strictFidelityReview(protectedFeatures) : null,
      repairedScene,
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
      ? "Image 1 is the architectural drawing to render"
      : "Image 1 is the building to render";
  return (
    `${design} as ${styleText}. ` +
    "Images 2 onward are swatch boards for materials, finishes, colours, lighting and landscape only; never copy their buildings."
  );
}

const REFERENCE_FORM_LOCK =
  "NON-NEGOTIABLE SOURCE DESIGN CONTRACT: Treat image 1 as the fixed building and fixed camera. Preserve its exact " +
  "silhouette, footprint, massing, floor count, proportions, roof shape and ridges, eaves, windows, doors, balconies, garages, " +
  "porches, gazebos, openings, camera angle and framing. Map prototype colours and surface finishes only onto the corresponding " +
  "existing image 1 surfaces. Do not add, remove, resize, relocate or replace any architectural element. Never copy, blend with, " +
  "interpolate toward, or match a prototype's shape, layout, camera angle, perspective or composition.";

const FEATURE_LABELS: Record<ProtectedGeometryFeature, string> = {
  silhouette: "silhouette",
  roof: "roof and ridges",
  openings: "openings",
  massing: "massing",
  camera: "camera and framing",
};

function strictFidelityReview(features: ProtectedGeometryFeature[]): string {
  const criteria = features.map((feature) => FEATURE_LABELS[feature]).join(", ");
  return (
    `STRICT FIDELITY MODE: The source ${criteria || "silhouette, roof and ridges, openings, massing and camera"} are protected acceptance criteria. ` +
    "If a requested material or reference feature conflicts with any protected criterion, keep the source criterion and omit the conflicting feature."
  );
}

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
  /** The user's own edit description; may be empty when a reference or the environment carries the intent. */
  prompt: string;
  edit: RenderEditSettings;
  hasReferences: boolean;
  /**
   * A painted or auto-selected area limits the edit. Only that area of the result is kept, so
   * the environment is left out here and applied by its own pass (buildEnvironmentPrompt).
   */
  hasSelection?: boolean;
  /** The model is sent a close-up crop of the selection rather than the whole image (see editCropFor). */
  isCloseUp?: boolean;
  /**
   * The selection's separate areas, largest first: what the person said each is ("front door")
   * and where it sits in the image the model is given ("in the centre"; see selectionPlacement).
   */
  selectionAreas?: { label?: string; placement?: string }[];
  /**
   * What each reference is for, in image order (image 2 onward). Omitted with one reference
   * means a single untagged one, which keeps the original single-reference wording.
   */
  references?: EditReference[];
  /** The style the image being edited was rendered in; omitted or "Photorealistic" needs no hint. */
  style?: string;
}

const KEEP_THE_REST = "Keep everything else in the image exactly as it is.";
const KEEP_THE_REST_AFTER_CHANGES = "Apart from these changes, keep everything else in the image exactly as it is.";

/** Every edit keeps the building itself; a reference or environment change is never a redesign. */
const EDIT_FORM_LOCK =
  "Keep the building's geometry, proportions, roof shape, window and door positions, and the camera angle and framing exactly as they are.";

const TIME_OF_DAY: Record<EditTimeOfDay, string> = {
  morning: "Set the scene in soft early-morning light, with a low cool sun and long gentle shadows.",
  midday: "Set the scene at midday, with bright sun high overhead and short crisp shadows.",
  "golden-hour": "Set the scene at golden hour, with warm low sunlight and long warm shadows across the facade.",
  dusk: "Set the scene at dusk, with a deep blue sky after sunset and warm light glowing from the windows and exterior fixtures.",
  night: "Set the scene at night, with a dark sky and the building lit by its warm interior and exterior lighting.",
};

const SEASONS: Record<EditSeason, string> = {
  spring: "Make it spring: fresh green foliage, blossoming trees and new lawn.",
  summer: "Make it summer: lush, full green trees, hedges and lawns.",
  autumn: "Make it autumn: trees in orange, red and gold foliage, with some fallen leaves on the ground.",
  winter: "Make it winter: bare deciduous trees and dormant planting.",
};

const WEATHER: Record<EditWeather, string> = {
  clear: "Give it a clear blue sky.",
  overcast: "Give it an overcast sky with soft, diffuse light and no hard shadows.",
  rain: "Make it rainy: a grey sky, light rain, and wet, reflective paving and surfaces.",
  snow: "Make it snowy: falling snow, with snow settled on the roof, ground, ledges and planting.",
  fog: "Add light fog that softens the background, with muted, diffuse light.",
};

const ARCHITECTURAL_STYLES: Record<EditStyle, string> = {
  modern: "modern: smooth light render, slim dark window frames, flush minimal trim and glass balustrades",
  minimalist: "minimalist: a restrained palette of white and pale grey, flush detailing and no ornament",
  scandinavian: "Scandinavian: light timber cladding, white trim, black window frames and a calm natural palette",
  mediterranean: "Mediterranean: warm white or sand-coloured stucco, terracotta accents and wrought-iron details",
  farmhouse: "modern farmhouse: white board-and-batten siding, black window frames and natural wood accents",
  industrial: "industrial: exposed brick, dark steel frames and metal detailing",
  tropical: "tropical: natural timber, light stone, shaded openings and lush planting",
  classic: "classic: refined stone or render finishes, painted mouldings and traditional trim",
};

const FACADE_MATERIAL_TEXT: Record<FacadeMaterial, string> = {
  brick: "clay brick",
  stone: "natural stone cladding",
  stucco: "smooth painted stucco render",
  timber: "timber cladding",
  concrete: "smooth architectural concrete",
  metal: "standing-seam metal panels",
  glass: "glazed panels",
};

/** One sentence per environment change, in a fixed order; empty when nothing changes. */
function environmentSentences(environment: EditEnvironment | undefined): string[] {
  if (!environment) return [];
  const facadeColor = environment.facadeColor?.trim();
  const material = environment.facadeMaterial ? FACADE_MATERIAL_TEXT[environment.facadeMaterial] : null;
  // Colour and material describe the same walls, so they read best as one instruction.
  const facade = material
    ? `Clad the facade walls in ${material}${facadeColor ? `, coloured ${facadeColor}` : ""}, keeping window frames, doors, roof and trim as they are.`
    : facadeColor
      ? `Paint the facade walls ${facadeColor}, keeping window frames, doors, roof and trim their current colours.`
      : null;
  return [
    environment.style
      ? `Restyle the finishes and details of the building as ${ARCHITECTURAL_STYLES[environment.style]}, without changing its form.`
      : null,
    facade,
    environment.timeOfDay ? TIME_OF_DAY[environment.timeOfDay] : null,
    environment.season ? SEASONS[environment.season] : null,
    environment.weather ? WEATHER[environment.weather] : null,
  ].filter((sentence): sentence is string => sentence !== null);
}

/** Capitalizes and terminates free text so it reads as its own sentence next to others. */
function asSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const capitalized = trimmed[0]!.toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

/**
 * A non-default style on the image being edited would otherwise drift toward photoreal —
 * these models have no memory of how the source was rendered.
 */
function styleHintFor(style: string | undefined): string {
  return style && style !== "Photorealistic" && STYLE_DESCRIPTIONS[style] ? `Keep this in ${STYLE_DESCRIPTIONS[style]}.` : "";
}

/** The change itself for a prompt-only edit: the user's words, or an action verb built around them. */
function promptInstruction(subject: string, edit: RenderEditSettings): string {
  if (!subject) return "";
  if (edit.mode === "prompt" || !edit.action) return asSentence(subject);
  return {
    add: `Add ${subject} to the building.`,
    remove: `Remove ${subject} from the image and fill the area to match its surroundings.`,
    change: asSentence(`Change ${subject}`),
  }[edit.action];
}

/** A selection tag as safe prompt text: one short line, no quotes or stray punctuation. */
export function cleanSelectionLabel(label: string | undefined): string {
  return (label ?? "")
    .replace(/["“”]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?,;:]+$/, "")
    .slice(0, 60)
    .toLowerCase();
}

/** Ends the close-up sentence: ": the front door, in the centre of this image." or just "." */
function selectionTarget(label: string, placement: string, frame: string): string {
  if (label && placement) return `: the ${label}, ${placement} of ${frame}.`;
  if (label) return `: the ${label}.`;
  if (placement) return `. The area to change is ${placement} of ${frame}.`;
  return ".";
}

/** Names a selection on the whole image, which has no close-up sentence to carry it. */
function selectionSentence(label: string, placement: string, frame: string): string {
  if (label && placement) return `The area to change is the ${label}, ${placement} of ${frame}.`;
  if (label) return `The area to change is the ${label}.`;
  if (placement) return `The area to change is ${placement} of ${frame}.`;
  return "";
}

/** "a", "a and b", "a, b and c". */
function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** One of several areas, in words: "the front door in the lower right", "an area at the top". */
function areaPhrase({ label, placement }: { label: string; placement: string }): string {
  if (label && placement) return `the ${label} ${placement}`;
  if (label) return `the ${label}`;
  if (placement) return `an area ${placement}`;
  return "";
}

/** Lists several selected areas: "In this image, the areas to change are the door on the left and the window at the top." */
function areasSentence(areas: { label: string; placement: string }[], frame: string): string {
  // Auto select's "windows" can tag several areas alike; naming each twice reads as noise.
  const phrases = [...new Set(areas.map(areaPhrase).filter(Boolean))];
  if (phrases.length === 0) return "";
  const unnamed = areas.filter((area) => !areaPhrase(area)).length;
  if (unnamed > 0) phrases.push(unnamed === 1 ? "one more selected area" : `${unnamed} more selected areas`);
  return `In ${frame}, the areas to change are ${joinList(phrases)}.`;
}

/**
 * The change itself for an edit with a reference. The reference is always image 2 (an edit
 * takes exactly one); image 1 is the render being edited, or a close-up of its selected area.
 */
function referenceInstruction(method: EditMethod, subject: string, hasSelection: boolean, target = "the selected element"): string {
  if (method === "reference-prompt") {
    return (
      `Use image 2 as the reference for this change: ${asSentence(subject)} ` +
      "Take from image 2 only what this asks for, matching its design, shape details, material, colour and finish, " +
      "and apply it to the corresponding elements of image 1, keeping each one in its current position and size."
    );
  }
  return hasSelection
    ? `Make ${target} match the corresponding element in image 2: its design, shape details, material, colour ` +
        "and finish, fitted to the element's current position, size and perspective."
    : "Apply the look of image 2 to the building in image 1: its materials, finishes, colours and detailing, mapped onto " +
        "the matching surfaces of image 1. Never copy image 2's building, layout or viewpoint.";
}

/**
 * What each reference target dresses, and what to take from its image. A swatch of roof tiles
 * says nothing about walls, so each reference is pointed at its own part of the building.
 */
const REFERENCE_TARGET_TEXT: Record<Exclude<EditReferenceTarget, "look" | "other">, { name: string; part: string; take: string }> = {
  roof: { name: "a roof reference", part: "the roof", take: "roofing material, tile or sheet shape and pattern, colour and finish" },
  walls: { name: "a wall reference", part: "the exterior walls", take: "material, texture, pattern, colour and finish" },
  windows: { name: "a window reference", part: "the windows", take: "frame style, glazing pattern, material, colour and finish" },
  doors: { name: "a door reference", part: "the doors", take: "design, panelling, material, colour, finish and hardware" },
  paving: { name: "a paving reference", part: "the driveway, paths and paved ground", take: "paver shape, pattern, colours and laying layout" },
  columns: { name: "a column reference", part: "the columns and pillars", take: "profile, detailing, material, colour and finish" },
  railings: { name: "a railing reference", part: "the balcony railings and balustrades", take: "design, material, colour and finish" },
  garden: { name: "a landscaping reference", part: "the garden and outdoor areas", take: "planting, lawn, hedges, garden features and their arrangement" },
};

/** A reference's note as safe prompt text: one line, no quotes, no trailing punctuation. */
export function cleanReferenceNote(note: string | undefined): string {
  return (note ?? "")
    .replace(/["“”]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?,;:]+$/, "")
    .slice(0, MAX_EDIT_REFERENCE_NOTE_CHARS);
}

/** One sentence naming what image `n` is for and what to take from it. */
function taggedReferenceSentence(n: number, reference: EditReference, hasSelection: boolean): string {
  const note = cleanReferenceNote(reference.note);
  const said = note ? ` Note about image ${n}: ${asSentence(note)}` : "";
  if (reference.target === "other") {
    return `Image ${n} is a reference for ${note || "part of the building"}: apply its design, material, colour and finish there.`;
  }
  if (reference.target === "look") {
    const onto = hasSelection ? "the selected elements" : "the matching surfaces of image 1";
    return `Image ${n} shows the overall look to follow: apply its materials, finishes, colours and detailing to ${onto}.${said}`;
  }
  const { name, part, take } = REFERENCE_TARGET_TEXT[reference.target];
  return `Image ${n} is ${name}: give ${part} of image 1 its ${take}.${said}`;
}

/** "Images 2 and 3 are" / "Images 2 to 4 are", for the role sentence of several references. */
function referenceRange(count: number): string {
  return count === 2 ? "Images 2 and 3 are references" : `Images 2 to ${count + 1} are references`;
}

/** Tagged references, or several: one sentence per image, then how to combine them. */
function taggedReferenceInstruction(method: EditMethod, subject: string, references: EditReference[], hasSelection: boolean): string {
  const each = references.map((reference, index) => taggedReferenceSentence(index + 2, reference, hasSelection));
  const several = references.length > 1;
  const combine = several
    ? "Use each reference only for its own part, fitted to that part's current shape, size and perspective."
    : "Fit it to that part's current shape, size and perspective.";
  const within = hasSelection ? "Change those parts only inside the selected area." : "";
  const ask = method === "reference-prompt" && subject
    ? `Make this change: ${asSentence(subject)} Take from the ${several ? "references" : "reference"} only what this change asks for.`
    : "";
  return [ask, ...each, combine, within, `Never copy a reference's building, layout or viewpoint.`].filter(Boolean).join(" ");
}

/**
 * Composes the model prompt for an Edit-tab job's main pass. With a selection, only that area
 * of the result is composited back (see engine.ts), so the environment is left out and applied
 * over the whole result by its own pass; without one, it is part of this prompt.
 */
export function buildEditPrompt({
  prompt,
  edit,
  hasReferences,
  hasSelection = false,
  isCloseUp = false,
  selectionAreas,
  references,
  style,
}: EditPromptOptions): string {
  const subject = prompt.trim();
  const method = editMethodFor(edit, { hasReferences, hasPrompt: subject !== "" });
  const usesReference = hasReferences && method !== "prompt";
  const tags = usesReference ? (references?.length ? references : [{ target: "look" as const }]) : [];
  // One untagged reference keeps the original wording; tags or several images name each one's job.
  const tagged = tags.length > 1 || tags.some((reference) => reference.target !== "look" || cleanReferenceNote(reference.note));
  const referenceRole = !tagged
    ? "Image 2 is the reference."
    : tags.length === 1
      ? "Image 2 is a reference for the part named below."
      : `${referenceRange(tags.length)}, each for the part it is tagged with below.`;
  const environment = hasSelection ? [] : environmentSentences(edit.environment);
  const areas = hasSelection
    ? (selectionAreas ?? []).map((area) => ({ label: cleanSelectionLabel(area.label), placement: area.placement?.trim() ?? "" }))
    : [];
  const several = areas.length > 1;
  const { label, placement } = areas[0] ?? { label: "", placement: "" };
  // Tags point the model at the selected elements; without them there's nothing to name.
  const labels = [...new Set(areas.map((area) => area.label).filter(Boolean))];
  const allTagged = areas.length > 0 && areas.every((area) => area.label);
  const target = allTagged ? joinList(labels.map((name) => `the ${name}`)) : "";
  const describe = (frame: string) => (several ? areasSentence(areas, frame) : selectionSentence(label, placement, frame));

  const roles = usesReference
    ? isCloseUp
      ? several
        ? `Image 1 is a close-up of the selected parts of the building to edit. ${referenceRole} ${describe("image 1")}`
        : `Image 1 is a close-up of the selected part of the building to edit${selectionTarget(label, placement, "image 1")} ${referenceRole}`
      : `Image 1 is the building image to edit. ${referenceRole}${hasSelection ? ` ${describe("image 1")}` : ""}`
    : // Already a close-up crop of just the selected region, but saying so in words keeps the
      // model from mistaking it for the whole building.
      isCloseUp
      ? several
        ? `This is a close-up of the selected parts of the building. ${describe("this image")}`
        : `This is a close-up of the selected part of the building${selectionTarget(label, placement, "this image")}`
      : hasSelection
        ? describe("the image")
        : "";
  const instruction = usesReference
    ? tagged
      ? taggedReferenceInstruction(method, subject, tags, hasSelection)
      : referenceInstruction(method, subject, hasSelection, target || (several ? "the selected elements" : "the selected element"))
    : promptInstruction(subject, edit);
  const focus =
    hasSelection && subject && !usesReference && labels.length > 0
      ? target
        ? `Apply this change to ${target} only.`
        : "Apply this change to the selected areas only."
      : "";
  // A prompt-only edit names its own change; a reference or the environment could otherwise be
  // read as licence to rebuild, so those always restate the form lock.
  const formLock = usesReference || environment.length > 0 ? EDIT_FORM_LOCK : "";

  return [
    roles.trim(),
    instruction,
    focus,
    ...environment,
    formLock,
    environment.length > 0 ? KEEP_THE_REST_AFTER_CHANGES : KEEP_THE_REST,
    styleHintFor(style),
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The second pass of a selection edit that also changes the environment: the selection's
 * result is done, and this applies the environment over the whole image.
 */
export function buildEnvironmentPrompt({ environment, style }: { environment: EditEnvironment; style?: string }): string {
  return [...environmentSentences(environment), EDIT_FORM_LOCK, KEEP_THE_REST_AFTER_CHANGES, styleHintFor(style)]
    .filter(Boolean)
    .join(" ");
}
