import type { PanelTab } from "../canvas/hooks/useCanvasStore";

export const GUIDE_CATALOG_VERSION = 1;

export type GuideTopicId =
  | "control.uploads"
  | "control.style"
  | "control.tabs"
  | "control.direction"
  | "control.source"
  | "control.influence"
  | "control.preserve"
  | "control.generate"
  | "canvas.stage"
  | "canvas.tabs"
  | "canvas.filmstrip"
  | "canvas.editToolbar"
  | "results.panel"
  | "edit.modes"
  | "edit.selection";

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
    title: "Building views",
    short: "Upload Front, Right, Back, and Left — empty slots are skipped.",
    body: "Each slot is one elevation of the same building. Upload only the sides you have. Generate renders every filled view and ignores empty ones.",
    how: "Click a slot to upload, or drop a PNG, JPEG, or WebP. Extra views such as a roof or isometric sit under Add view.",
    article: "getting-started",
    tab: "render",
    legend: 1,
  },
  "control.style": {
    id: "control.style",
    title: "Style and resolution",
    short: "Photorealistic, sketch, or watercolor — 1K is available on every plan.",
    body: "Style sets the look of the visualization. Resolution is 1K today; 2K and 4K stay locked until the plan allows them.",
    how: "Pick a style before Generate. Changing style later does not rewrite renders already in history.",
    article: "consistent-results",
    tab: "render",
  },
  "control.tabs": {
    id: "control.tabs",
    title: "Render and Edit",
    short: "Render creates a visualization. Edit changes one part of it.",
    body: "Render is for new images from your elevations. Edit is for a later pass: swap a material, restyle a region, or describe a change without touching the rest of the building.",
    how: "Finish a render first, then switch to Edit — or choose Edit this render from the results panel.",
    article: "regional-editing",
    legend: 7,
  },
  "control.direction": {
    id: "control.direction",
    title: "Prompt and references",
    short: "Optional direction for materials, light, and setting.",
    body: "The prompt describes atmosphere and materials in a sentence. Reference images are stronger: the model blends them with your elevation so cladding, landscape, and lighting follow what you show.",
    how: "Leave the prompt empty if the elevation is enough. Add up to eight references from upload, the library, Unsplash, or a URL.",
    article: "getting-started",
    tab: "render",
    legend: 4,
  },
  "control.source": {
    id: "control.source",
    title: "Source type",
    short: "Photo / 3D vs a line drawing — the model follows them differently.",
    body: "Photo / 3D is for a photograph or massing render. Drawing tells the model to follow CAD or elevation lines exactly, so openings and edges stay put.",
    how: "Use Drawing for sketches and CAD exports. Use Photo / 3D for photographs and 3D views.",
    article: "consistent-results",
    tab: "render",
  },
  "control.influence": {
    id: "control.influence",
    title: "Style influence",
    short: "How far references and style are allowed to push the result.",
    body: "1 keeps a light material cue. 4 is the closest match to your references. Higher values restyle more of the facade; they still should not invent new openings.",
    how: "Start at 2. Raise it if the render ignores your references; lower it if the building starts to drift.",
    article: "consistent-results",
    tab: "render",
  },
  "control.preserve": {
    id: "control.preserve",
    title: "Preserve structure",
    short: "Keeps window counts, roofs, and massing from being redesigned.",
    body: "When this is on, the model may change material, colour, and finish, but it should not add balconies, move windows, or reshape the building.",
    how: "Leave it on for client elevations. Turn it off only when you want a looser interpretation.",
    article: "consistent-results",
    tab: "render",
  },
  "control.generate": {
    id: "control.generate",
    title: "Generate",
    short: "Renders every uploaded view. Credits are shown underneath.",
    body: "This is the action. The number beside the button is variations per view. Cost is credits for your account, or the demo budget if you are an admin.",
    how: "Upload at least one view, then Generate. Results appear in the right-hand panel as they finish.",
    article: "getting-started",
    legend: 5,
  },
  "canvas.stage": {
    id: "canvas.stage",
    title: "Canvas",
    short: "The active elevation lives here. Pan, zoom, or drop a file onto an empty view.",
    body: "The stage shows one building view at a time. Scroll to zoom, drag the empty canvas to pan. When a view has no image yet, drop a file onto this area.",
    how: "Use Fit in the top bar to reset zoom. In Edit, rectangle and polygon tools appear on this stage so you can mark a region.",
    article: "getting-started",
    legend: 3,
  },
  "canvas.tabs": {
    id: "canvas.tabs",
    title: "Elevation tabs",
    short: "Switch Front, Right, Back, and Left. Add extra views from here.",
    body: "These tabs are the same building, seen from each side. The filmstrip under the canvas mirrors them and is the fastest place to drop a missing elevation.",
    how: "Click a tab to focus that view. Add view creates a roof, isometric, site plan, or a custom label.",
    article: "getting-started",
    legend: 2,
  },
  "canvas.filmstrip": {
    id: "canvas.filmstrip",
    title: "View filmstrip",
    short: "Thumbnails of every elevation. Empty slots wait for an upload.",
    body: "Each tile is one view. A filled tile switches the canvas; an empty tile opens the file picker. The dashed tile adds another view.",
    how: "Upload here if you prefer working from the canvas instead of the left-hand list.",
    article: "getting-started",
  },
  "canvas.editToolbar": {
    id: "canvas.editToolbar",
    title: "Selection tools",
    short: "Rectangle or polygon — only the marked area is regenerated.",
    body: "Manual Edit uses these tools on the canvas. Draw a rectangle, or click to place a polygon and close it on the first point.",
    how: "Switch Selection mode to Manual first, then draw. Clear removes the current mark.",
    article: "regional-editing",
    tab: "edit",
  },
  "results.panel": {
    id: "results.panel",
    title: "Past renders",
    short: "History of every generate and edit for this project.",
    body: "Finished images land here. Open one full-size, download it, reuse its prompt and settings, set it as the new base elevation, or start a regional edit from it.",
    how: "The column stays empty until a view is uploaded or a render finishes. Star important results so they are easier to find.",
    article: "getting-started",
    legend: 6,
  },
  "edit.modes": {
    id: "edit.modes",
    title: "Edit modes",
    short: "Borrow a finish, follow a whole building, or describe the change.",
    body: "Element / texture copies a material onto the selected region. Whole building pulls architectural language from a reference house. Prompt edit finds the change from a sentence.",
    how: "Pick a mode, add a reference or a prompt, then Generate. Use Auto select unless you need to draw the region yourself.",
    article: "regional-editing",
    tab: "edit",
    legend: 8,
  },
  "edit.selection": {
    id: "edit.selection",
    title: "Selection mode",
    short: "Auto finds the region from your prompt. Manual lets you draw it.",
    body: "Auto groups similar surfaces — a roof face, a window set — instead of grabbing the whole elevation. Manual is the rectangle and polygon tools on the canvas.",
    how: "Auto needs a short description such as “roof tiles”. Manual needs a drawn region before Generate will run.",
    article: "regional-editing",
    tab: "edit",
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
