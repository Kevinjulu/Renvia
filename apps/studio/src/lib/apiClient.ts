import { useAuth } from "@clerk/react";
import type {
  CreateCanvasNodeRequest,
  CreateCanvasNodeResponse,
  CreateProjectRequest,
  CreateRenderRequest,
  CreateRenderResponse,
  DeleteProjectResponse,
  GetRenderResponse,
  ListCanvasNodesResponse,
  ListProjectsResponse,
  ListRendersResponse,
  MeResponse,
  Project,
  UpdateCanvasNodeRequest,
  UpdateCanvasNodeResponse,
  UpdateProjectRequest,
  UploadImageResponse,
} from "@renvia/types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

type GetToken = () => Promise<string | null>;

async function request<T>(getToken: GetToken, path: string, init?: RequestInit): Promise<T> {
  const token = await getToken();
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}/api${path}`, { ...init, headers });
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function useApiClient() {
  const { getToken } = useAuth();

  return {
    getMe: () => request<MeResponse>(getToken, "/me"),
    createRender: (body: CreateRenderRequest) =>
      request<CreateRenderResponse>(getToken, "/renders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    getRender: (id: string) => request<GetRenderResponse>(getToken, `/renders/${id}`),
    listRenders: (projectId: string) =>
      request<ListRendersResponse>(getToken, `/renders?projectId=${projectId}`),
    uploadImage: (file: File) =>
      request<UploadImageResponse>(getToken, "/uploads", {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      }),
    listCanvasNodes: (projectId: string) =>
      request<ListCanvasNodesResponse>(getToken, `/canvas-nodes?projectId=${projectId}`),
    createCanvasNode: (body: CreateCanvasNodeRequest) =>
      request<CreateCanvasNodeResponse>(getToken, "/canvas-nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    updateCanvasNode: (id: string, body: UpdateCanvasNodeRequest) =>
      request<UpdateCanvasNodeResponse>(getToken, `/canvas-nodes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    listProjects: () => request<ListProjectsResponse>(getToken, "/projects"),
    getProject: (id: string) => request<Project>(getToken, `/projects/${id}`),
    createProject: (body: CreateProjectRequest) =>
      request<Project>(getToken, "/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    updateProject: (id: string, body: UpdateProjectRequest) =>
      request<Project>(getToken, `/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    deleteProject: (id: string) => request<DeleteProjectResponse>(getToken, `/projects/${id}`, { method: "DELETE" }),
  };
}
