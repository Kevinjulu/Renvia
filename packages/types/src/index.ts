export type RenderStatus = "pending" | "processing" | "succeeded" | "failed";

export interface RenderJob {
  id: string;
  projectId: string;
  status: RenderStatus;
  sourceImageUrl: string;
  resultImageUrl: string | null;
  prompt: string;
  resolution: string;
  style: string;
  viewKey: string | null;
  viewLabel: string | null;
  falRequestId: string | null;
  errorMessage: string | null;
  model: string | null;
  /** Estimated engine cost in USD micros (1e-6 USD); 0 in mock mode. */
  costMicros: number;
  /** Settings the render was generated with, for "use prompt and settings". */
  settings: RenderGenerationSettings | null;
  createdAt: string;
  updatedAt: string;
}

/** mock = free placeholder results; dev = cheapest real model; prod = production model. */
export type RenderEngineMode = "mock" | "dev" | "prod";

/** drawing = CAD/line elevation (geometry-locked model); photo = photo or 3D massing. */
export type RenderSourceType = "drawing" | "photo";

export type EditMode = "element" | "building" | "prompt";
export type EditAction = "add" | "remove" | "change";

/** Present on edit jobs (Edit tab); absent on renders. */
export interface RenderEditSettings {
  mode: EditMode;
  action?: EditAction;
  /** White-on-black PNG at the source image's size; white marks the area to edit. */
  maskImageUrl?: string;
}

/** Which model family serves a job. */
export type RenderRoute =
  | RenderSourceType
  | "references"
  | "edit"
  | "edit-references"
  | "inpaint"
  | "inpaint-reference";

export function renderRouteFor(settings: RenderGenerationSettings): RenderRoute {
  const hasReferences = (settings.referenceImageUrls?.length ?? 0) > 0;
  if (settings.edit) {
    if (settings.edit.maskImageUrl) return hasReferences ? "inpaint-reference" : "inpaint";
    return hasReferences ? "edit-references" : "edit";
  }
  return hasReferences ? "references" : (settings.sourceType ?? "photo");
}

export interface RoutePrice {
  usd: number;
  /** When true, `usd` is per started megapixel of the source image (fal rounds up). */
  perMegapixel: boolean;
}

export function estimateImageCostUsd(price: RoutePrice, megapixels: number): number {
  return price.perMegapixel ? price.usd * Math.max(1, Math.ceil(megapixels)) : price.usd;
}

export interface RenderBudgetResponse {
  mode: RenderEngineMode;
  pricing: Record<RenderRoute, RoutePrice>;
  spentUsd: number;
  budgetUsd: number;
}

/** Optional generation knobs, mapped onto model inputs by the API's model registry. */
export interface RenderGenerationSettings {
  sourceType?: RenderSourceType;
  /** 1 (subtle) – 4 (maximum). */
  styleInfluence?: number;
  preserveStructure?: boolean;
  referenceImageUrls?: string[];
  edit?: RenderEditSettings;
}

export interface CreateRenderRequest {
  projectId: string;
  sourceImageUrl: string;
  prompt: string;
  resolution: string;
  style: string;
  viewKey?: string;
  viewLabel?: string;
  generationSettings?: RenderGenerationSettings;
}

export interface CreateRenderResponse {
  job: RenderJob;
}

export interface GetRenderResponse {
  job: RenderJob;
}

export interface ListRendersResponse {
  jobs: RenderJob[];
}

export interface UploadImageResponse {
  publicUrl: string;
}

export type CanvasNodeType = "image" | "compare-slider";

export interface CanvasNodeRecord {
  id: string;
  projectId: string;
  type: CanvasNodeType;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ListCanvasNodesResponse {
  nodes: CanvasNodeRecord[];
}

export interface CreateCanvasNodeRequest {
  id: string;
  projectId: string;
  type: CanvasNodeType;
  data: Record<string, unknown>;
}

export interface CreateCanvasNodeResponse {
  node: CanvasNodeRecord;
}

export interface UpdateCanvasNodeRequest {
  data: Record<string, unknown>;
}

export interface UpdateCanvasNodeResponse {
  node: CanvasNodeRecord;
}

export interface DeleteCanvasNodeResponse {
  id: string;
}

export interface MeResponse {
  id: string;
  clerkId: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectRequest {
  name: string;
}

export interface UpdateProjectRequest {
  name?: string;
  thumbnailUrl?: string;
}

export interface DeleteProjectResponse {
  id: string;
}

export interface ListProjectsResponse {
  projects: Project[];
}

export type ReferenceImageSource = "upload" | "unsplash" | "url";

export interface ReferenceImage {
  id: string;
  ownerId: string;
  url: string;
  source: ReferenceImageSource;
  createdAt: string;
}

export interface CreateReferenceImageRequest {
  url: string;
  source: ReferenceImageSource;
}

export interface ListReferenceImagesResponse {
  references: ReferenceImage[];
}

export interface DeleteReferenceImageResponse {
  id: string;
}
