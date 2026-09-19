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
  createdAt: string;
  updatedAt: string;
}

/** mock = free placeholder results; dev = cheapest real model; prod = production model. */
export type RenderEngineMode = "mock" | "dev" | "prod";

export interface RenderBudgetResponse {
  mode: RenderEngineMode;
  unitCostUsd: number;
  spentUsd: number;
  budgetUsd: number;
}

/** Optional generation knobs — accepted now, applied when fal/AI is connected. */
export interface RenderGenerationSettings {
  styleInfluence?: number;
  preserveStructure?: boolean;
  referenceImageUrls?: string[];
  atmospherePreset?: string | null;
}

export interface CreateRenderRequest {
  projectId: string;
  sourceImageUrl: string;
  prompt: string;
  resolution: string;
  style: string;
  viewKey?: string;
  viewLabel?: string;
  /** Prep for fal — stored on the job event; not required for queueing today. */
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
