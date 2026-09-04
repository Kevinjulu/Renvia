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
  falRequestId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRenderRequest {
  projectId: string;
  sourceImageUrl: string;
  prompt: string;
  resolution: string;
  style: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectRequest {
  name: string;
}

export interface UpdateProjectRequest {
  name: string;
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
