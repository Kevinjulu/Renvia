import type { PanelTab } from "../canvas/hooks/useCanvasStore";

export const GUIDE_CATALOG_VERSION = 1;

export type GuideTopicId =
  | "control.uploads"
  | "control.style"
  | "control.tabs"
  | "control.direction"
  | "control.influence"
  | "control.generate"
  | "canvas.stage"
  | "canvas.tabs"
  | "canvas.filmstrip"
  | "canvas.editToolbar"
  | "results.panel"
  | "edit.method"
  | "edit.prompt"
  | "edit.scope"
  | "edit.environment"
  | "edit.apply"
  | "beta.button";

export interface GuideTopic {
  id: GuideTopicId;
  title: string;
  short: string;
  body: string;
  how: string;
  article?: string;
  tab?: PanelTab;
  /** Numbered pin in legend mode. Omitted topics are inline-help only. */
  legend?: number;
}

export const GUIDE_TOPICS: Record<GuideTopicId, GuideTopic> = {
  "control.uploads": {
    id: "control.uploads",
    title: "Active elevation",
    short: "The side selected on the canvas — switch sides with the tabs or filmstrip.",
    body: "Each elevation is one side of the same building. Upload only the sides you have. Generate renders every uploaded elevation and ignores empty ones. Switch one off to skip it without deleting it.",
    how: "Click the card or drop a PNG, JPEG, or WebP to upload. Replace swaps the image; Remove drops it. Pick another side from the tabs above the canvas or the filmstrip below it.",
    article: "getting-started",
    tab: "render",
    legend: 1,
  },
  "control.style": {
    id: "control.style",
    title: "Style and aspect ratio",
    short: "Photorealistic, sketch, or watercolor — plus the shape the render comes out in.",
    body: "Style sets the look of the visualization. Aspect ratio picks the output's shape — by default it matches your uploaded elevation; open it to force a fixed ratio like 16:9 or 3:4.",
    how: "Pick a style before Generate. Changing style later does not rewrite renders already in history.",
    article: "consistent-results",
    tab: "render",
  },
  "control.tabs": {
    id: "control.tabs",
    title: "Render and Edit",
    short: "Render creates a visualization. Edit refines a finished render.",
    body: "Render is for new images from your elevations. Edit is for a later pass: write a prompt, borrow from up to five tagged reference images, or both, on the whole render or one selected area, and optionally change the time of day, season, weather or facade.",
    how: "Finish a render first, then switch to Edit — or choose Edit this render from the results panel.",
    article: "regional-editing",
    legend: 7,
  },
  "control.direction": {
    id: "control.direction",
    title: "Prompt and references",
    short: "Direction for materials, light, and setting. Add a reference image or a prompt.",
    body: "The prompt describes atmosphere and materials in a sentence. Reference images are stronger: the model blends them with your elevation so cladding, landscape, and lighting follow what you show.",
    how: "Generate needs at least one reference image or a prompt. References usually work best: add up to eight from upload, the library, or a URL. Not sure where to start? Open Library and pick a sample from Windows, Roof, Doors, Pillars, Outdoors or Exterior.",
    article: "getting-started",
    tab: "render",
    legend: 4,
  },
  "control.influence": {
    id: "control.influence",
    title: "Style influence",
    short: "How much of your reference images' look the render takes on.",
    body: "With references attached, 1 borrows only their palette and mood, 2 their main materials and colours, 3 also their details such as window frames, railings and soffits, and 4 their full visual character. At every level the shape and camera angle come from your elevation, not the references.",
    how: "Use 3 or 4 when you want the render to look like your reference. Without references, the level sets how strongly the chosen style is applied.",
    article: "consistent-results",
    tab: "render",
  },
  "control.generate": {
    id: "control.generate",
    title: "Generate",
    short: "Renders every uploaded elevation. Credits are shown underneath.",
    body: "This is the action. The number beside the button is variations per elevation. If your plan runs fewer renders at once than you have elevations, the rest wait their turn and the button shows how far along it is. Cost is credits for your account, or the demo budget if you are an admin.",
    how: "Upload at least one elevation, add a reference image or a prompt, then Generate. Results appear in the right-hand panel as they finish.",
    article: "getting-started",
    legend: 5,
  },
  "canvas.stage": {
    id: "canvas.stage",
    title: "Canvas",
    short: "The active elevation lives here. Pan, zoom, or drop a file onto an empty elevation.",
    body: "The stage shows one elevation at a time. Scroll to zoom, drag the empty canvas to pan. When an elevation has no image yet, drop a file onto this area.",
    how: "Use Fit in the top bar to reset zoom. In Edit, your render opens full-size here with tools to mark the area to change.",
    article: "getting-started",
    legend: 3,
  },
  "canvas.tabs": {
    id: "canvas.tabs",
    title: "Elevation tabs",
    short: "Switch Front, Right, Back, and Left. Add extra elevations from here.",
    body: "These tabs are the same building, seen from each side. The filmstrip under the canvas mirrors them and is the fastest place to drop a missing elevation.",
    how: "Click a tab to focus that elevation. Add elevation creates a roof, isometric, site plan, or a custom label.",
    article: "getting-started",
    legend: 2,
  },
  "canvas.filmstrip": {
    id: "canvas.filmstrip",
    title: "Elevation filmstrip",
    short: "Thumbnails of every elevation. Empty slots wait for an upload.",
    body: "Each tile is one elevation. A filled tile switches the canvas; an empty tile opens the file picker. The dashed tile adds another elevation.",
    how: "Upload here if you prefer working from the canvas instead of the left-hand list.",
    article: "getting-started",
  },
  "canvas.editToolbar": {
    id: "canvas.editToolbar",
    title: "Selection tools",
    short: "Brush, rectangle or polygon — only the marked area is regenerated.",
    body: "Click Edit and your render opens with these tools on top. Paint with the brush, draw a rectangle, or click to place a polygon and close it on the first point.",
    how: "Optional: mark the area to change, then write your prompt. Clear removes the current mark; with nothing marked the whole image is edited.",
    article: "regional-editing",
    tab: "edit",
  },
  "results.panel": {
    id: "results.panel",
    title: "Past renders",
    short: "History of every generate and edit for this project.",
    body: "Finished images land here. Open one full-size, download it, reuse its prompt and settings, set it as the new base elevation, or start a regional edit from it.",
    how: "The column stays empty until an elevation is uploaded or a render finishes. Star important results so they are easier to find.",
    article: "getting-started",
    legend: 6,
  },
  "edit.method": {
    id: "edit.method",
    title: "How do you want to edit?",
    short: "Prompt, Reference or Both.",
    body: "Prompt changes the render from a sentence you write. Reference borrows a look from up to five images, each tagged with the part it is for. Both lets you say exactly what to take from the references.",
    how: "Most edits are one sentence, so start with Prompt. Use Reference when you have a picture of the roof, wall or paving you want.",
    article: "regional-editing",
    tab: "edit",
  },
  "edit.prompt": {
    id: "edit.prompt",
    title: "Write the prompt",
    short: "One clear sentence about the change.",
    body: "Say what should change and to what, for example “Replace the front door with a dark oak pivot door”. Short and specific works better than long and vague.",
    how: "Press Polish to tighten the wording. Everything you do not mention is kept as it is.",
    article: "regional-editing",
    tab: "edit",
  },
  "edit.scope": {
    id: "edit.scope",
    title: "Whole image or one area",
    short: "Mark just the part you want changed.",
    body: "Whole image applies the change everywhere. Selected area changes only the part you mark on the render and leaves the rest exactly as it was, which keeps the design safe.",
    how: "Choose Selected area, then paint, draw a shape or auto-select on the render. You can tag each area, like “front door”, to help the edit.",
    article: "regional-editing",
    tab: "edit",
  },
  "edit.environment": {
    id: "edit.environment",
    title: "Light, season and weather",
    short: "Optional changes to the whole scene.",
    body: "Change the time of day, season, weather or facade colour over the whole image. When you also select an area, the area is edited first and this is applied on top.",
    how: "Leave everything on Keep as is unless you want the mood to change. Each change is listed under What will happen.",
    article: "regional-editing",
    tab: "edit",
  },
  "edit.apply": {
    id: "edit.apply",
    title: "Apply edit",
    short: "Runs the edit and shows its credit cost.",
    body: "Apply edit makes the change as a new image in your history; the render you started from stays as it was. Edits cost credits but never count toward your daily render limit.",
    how: "Not sure what is missing? Press Apply edit anyway: it tells you what to add and points to it.",
    article: "regional-editing",
    tab: "edit",
  },
  // Only on screen for beta testers; it has no legend pin, so the legend never looks for it.
  "beta.button": {
    id: "beta.button",
    title: "Beta Program",
    short: "Your beta credits, missions and announcements — and where to report problems.",
    body: "This is your line to the Ramah Studio team. It shows your beta credits and how long your access lasts, your testing missions, and announcements from us.",
    how: "Open it any time to check your missions or replay this introduction. When something looks wrong in a render, report it from here so we can see exactly what happened.",
  },
};


export const LEGEND_TOPICS = Object.values(GUIDE_TOPICS)
  .filter((topic) => topic.legend != null)
  .sort((a, b) => (a.legend ?? 0) - (b.legend ?? 0));

export function getGuideTopic(id: GuideTopicId): GuideTopic {
  return GUIDE_TOPICS[id];
}

export type TourStep =
  | { kind: "welcome" }
  | { kind: "spot"; topicId: GuideTopicId; tab?: PanelTab }
  | { kind: "done" };

export const ORIENTATION_TOUR = {
  id: "orientation",
  steps: [
    { kind: "welcome" },
    { kind: "spot", topicId: "control.uploads", tab: "render" },
    { kind: "spot", topicId: "canvas.stage", tab: "render" },
    { kind: "spot", topicId: "canvas.tabs", tab: "render" },
    { kind: "spot", topicId: "control.direction", tab: "render" },
    { kind: "spot", topicId: "control.generate", tab: "render" },
    { kind: "spot", topicId: "results.panel", tab: "render" },
    { kind: "spot", topicId: "control.tabs", tab: "render" },
    { kind: "done" },
  ] satisfies TourStep[],
} as const;

export const WELCOME_COPY = {
  title: "Your visualization workspace",
  body: "Upload elevations, direct the render, and keep every result in one place. This walkthrough takes about a minute.",
};

export const DONE_COPY = {
  title: "That’s the layout",
  body: "Press Guide anytime to inspect a region, or hover the small question marks on denser controls. Replay this tour from the same menu.",
};

/** The beta tester's tour: the Studio's main path, then where to report what they find. */
export const BETA_TOUR = {
  id: "beta",
  steps: [
    { kind: "welcome" },
    { kind: "spot", topicId: "control.uploads", tab: "render" },
    { kind: "spot", topicId: "control.direction", tab: "render" },
    { kind: "spot", topicId: "control.generate", tab: "render" },
    { kind: "spot", topicId: "results.panel", tab: "render" },
    { kind: "spot", topicId: "control.tabs", tab: "render" },
    { kind: "spot", topicId: "canvas.stage", tab: "render" },
    { kind: "spot", topicId: "beta.button", tab: "render" },
    { kind: "done" },
  ] satisfies TourStep[],
} as const;

/** A short walk through the Edit tab: choose how, write the prompt, mark an area, apply. */
export const EDIT_TOUR = {
  id: "edit",
  steps: [
    { kind: "welcome" },
    { kind: "spot", topicId: "edit.method", tab: "edit" },
    { kind: "spot", topicId: "edit.prompt", tab: "edit" },
    { kind: "spot", topicId: "edit.scope", tab: "edit" },
    { kind: "spot", topicId: "canvas.editToolbar", tab: "edit" },
    { kind: "spot", topicId: "edit.environment", tab: "edit" },
    { kind: "spot", topicId: "edit.apply", tab: "edit" },
    { kind: "done" },
  ] satisfies TourStep[],
} as const;

export type TourId = "orientation" | "beta" | "edit";

export interface TourDefinition {
  id: TourId;
  /** Shown on the first card's corner. */
  label: string;
  steps: readonly TourStep[];
  welcome: { title: string; body: string };
  done: { title: string; body: string };
}

export const TOURS: Record<TourId, TourDefinition> = {
  orientation: { id: "orientation", label: "Studio tour", steps: ORIENTATION_TOUR.steps, welcome: WELCOME_COPY, done: DONE_COPY },
  edit: {
    id: "edit",
    label: "Edit tour",
    steps: EDIT_TOUR.steps,
    welcome: {
      title: "Make a good edit",
      body: "Change a door, a roof, the paving or the light on a finished render without touching the rest. Five quick steps, about 30 seconds.",
    },
    done: {
      title: "You are ready to edit",
      body: "Write a prompt, mark the area if you only want part of the image to change, then press Apply edit. Replay this from the Guide menu any time.",
    },
  },
  beta: {
    id: "beta",
    label: "Beta tour",
    steps: BETA_TOUR.steps,
    welcome: {
      title: "A quick look before you test",
      body: "Upload an elevation, render it, refine it with Edit, and download the result. This takes about a minute and ends at the place to report anything that looks wrong.",
    },
    done: {
      title: "You're ready to test",
      body: "Try your missions in the Beta Program area. If a render changes the architecture or something breaks, report it from the Beta button. Replay this tour from the same menu.",
    },
  },
};

export function tourFor(id: string | null): TourDefinition {
  if (id === "beta") return TOURS.beta;
  if (id === "edit") return TOURS.edit;
  return TOURS.orientation;
}
