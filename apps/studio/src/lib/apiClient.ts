import { useMemo, useRef } from "react";
import { useAuth } from "@clerk/react";
import type {
  CreateCanvasNodeRequest,
  BillingCatalogResponse,
  CreateCanvasNodeResponse,
  CreateProjectRequest,
  CreateReferenceImageRequest,
  CreateRenderRequest,
  CreateRenderResponse,
  CreateUpscaleResponse,
  CreateUpscaleRequest,
  CreateSegmentationRequest,
  CreateSegmentationResponse,
  DeleteProjectResponse,
  DeleteReferenceImageResponse,
  GetRenderResponse,
  ListCanvasNodesResponse,
  ListProjectsResponse,
  ListReferenceImagesResponse,
  ListRendersResponse,
  MeCreditsResponse,
  MeResponse,
  Project,
  PromptRepairResponse,
  ReferenceImage,
  RenderBudgetResponse,
  DeleteCanvasNodeResponse,
  UpdateCanvasNodeRequest,
  UpdateCanvasNodeResponse,
  UpdateProjectRequest,
  UpdateRenderRequest,
  UpdateRenderResponse,
  UploadImageResponse,
} from "@renvia/types";
import { reportClientError } from "../components/AppErrorHandling";
import { ConnectionError, connectionErrorFrom, markApiReachable, markApiUnreachable } from "./connection";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

/**
 * Longest a request may go unanswered before it's treated as a lost connection. Generous,
 * because queuing a render uploads its inputs to the model provider before it returns.
 */
const REQUEST_TIMEOUT_MS = 60_000;
/** Uploads carry the file itself, so they get longer on a slow connection. */
const UPLOAD_TIMEOUT_MS = 5 * 60_000;

type GetToken = () => Promise<string | null>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** Machine-readable reason from the response body, e.g. "insufficient_credits". */
    readonly code: string | null = null,
    /** Operator-authored copy for a refusal, when the server sent one. */
    readonly detail: string | null = null,
    /** The cap that was hit and how much of it was used, for refusals that report them. */
    readonly limit: number | null = null,
    readonly used: number | null = null,
    readonly requestId: string | null = null,
  ) {
    super(`API request failed: ${status}${code ? ` (${code})` : ""}`);
  }
}

const numberOrNull = (value: unknown) => (typeof value === "number" ? value : null);

/** fetch, failing with a ConnectionError when the request goes unanswered or times out. */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    // Any answer, even a refusal or a server error, means the API is reachable.
    markApiReachable();
    return response;
  } catch (error) {
    markApiUnreachable();
    throw connectionErrorFrom(error, timedOut);
  } finally {
    clearTimeout(timer);
  }
}

async function request<T>(getToken: GetToken, path: string, init?: RequestInit): Promise<T> {
  try {
    const token = await getToken();
    const headers = new Headers(init?.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    headers.set("X-Request-Id", crypto.randomUUID());
    const response = await fetchWithTimeout(`${API_BASE_URL}/api${path}`, { ...init, headers });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { code?: unknown; error?: unknown; limit?: unknown; used?: unknown }
        | null;
      throw new ApiError(
        response.status,
        typeof body?.code === "string" ? body.code : null,
        typeof body?.error === "string" ? body.error : null,
        numberOrNull(body?.limit),
        numberOrNull(body?.used),
        response.headers.get("X-Request-Id"),
      );
    }
    return response.json() as Promise<T>;
  } catch (error) {
    // An unanswered request is the network's doing, not a bug: the connection banner shows it,
    // and reporting it would flood incidents whenever someone's wifi drops.
    if (error instanceof ConnectionError) throw error;
    if (!(error instanceof ApiError) || error.status >= 500) {
      reportClientError(error, { requestId: error instanceof ApiError ? error.requestId : null });
    }
    throw error;
  }
}

function apiErrorFromBody(status: number, text: string, requestId: string | null = null) {
  let body: { code?: unknown; error?: unknown; limit?: unknown; used?: unknown } | null = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return new ApiError(
    status,
    typeof body?.code === "string" ? body.code : null,
    typeof body?.error === "string" ? body.error : null,
    numberOrNull(body?.limit),
    numberOrNull(body?.used),
    requestId,
  );
}

// fetch() can't report upload progress, so file uploads go through XHR.
async function uploadWithProgress(
  getToken: GetToken,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<UploadImageResponse> {
  const token = await getToken();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}/api/uploads`);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.setRequestHeader("X-Request-Id", crypto.randomUUID());
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      markApiReachable();
      if (xhr.status < 200 || xhr.status >= 300) {
        const error = apiErrorFromBody(xhr.status, xhr.responseText, xhr.getResponseHeader("X-Request-Id"));
        if (error.status >= 500) reportClientError(error, { requestId: error.requestId });
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText) as UploadImageResponse);
      } catch (error) {
        reject(error);
      }
    };
    xhr.onerror = () => {
      markApiUnreachable();
      reject(connectionErrorFrom(null, false));
    };
    xhr.ontimeout = () => {
      markApiUnreachable();
      reject(connectionErrorFrom(null, true));
    };
    xhr.send(file);
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** One stable client per component: the token getter is read through a ref, so effects can depend on the client safely. */
export function useApiClient(): ApiClient {
  const { getToken } = useAuth();
  const getTokenRef = useRef<GetToken>(getToken);
  getTokenRef.current = getToken;
  return useMemo(() => createApiClient(() => getTokenRef.current()), []);
}

function createApiClient(getToken: GetToken) {
  return {
    getMe: () => request<MeResponse>(getToken, "/me"),
    getMyCredits: () => request<MeCreditsResponse>(getToken, "/me/credits"),
    getBillingCatalog: () => request<BillingCatalogResponse>(getToken, "/billing/catalog"),
    createPaypalCheckout: (body: { kind: "credit_pack" | "subscription"; product: string; idempotencyKey: string }) => request<{ checkoutId: string; status: string; approvalUrl: string | null }>(getToken, "/billing/checkouts/paypal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    capturePaypalCheckout: (id: string) => request<{ checkoutId: string; status: "paid" }>(getToken, `/billing/checkouts/${id}/capture`, { method: "POST" }),
    createRender: (body: CreateRenderRequest) =>
      request<CreateRenderResponse>(getToken, "/renders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    repairPrompt: (prompt: string, sourceLocked = true) =>
      request<PromptRepairResponse>(getToken, "/renders/repair-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, sourceLocked }),
      }),
    upscaleRender: (id: string, body: CreateUpscaleRequest) =>
      request<CreateUpscaleResponse>(getToken, `/renders/${id}/upscale`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    createSegmentation: (body: CreateSegmentationRequest) =>
      request<CreateSegmentationResponse>(getToken, "/segmentations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    getRenderBudget: () => request<RenderBudgetResponse>(getToken, "/renders/budget"),
    getRender: (id: string) => request<GetRenderResponse>(getToken, `/renders/${id}`),
    cancelRender: (id: string) => request<GetRenderResponse>(getToken, `/renders/${id}/cancel`, { method: "POST" }),
    updateRender: (id: string, body: UpdateRenderRequest) =>
      request<UpdateRenderResponse>(getToken, `/renders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    hideRender: (id: string) => request<{ ok: true }>(getToken, `/renders/${id}`, { method: "DELETE" }),
    listRenders: (projectId: string) =>
      request<ListRendersResponse>(getToken, `/renders?projectId=${projectId}`),
    uploadImage: (file: File, onProgress?: (fraction: number) => void) =>
      uploadWithProgress(getToken, file, onProgress),
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
    deleteCanvasNode: (id: string) =>
      request<DeleteCanvasNodeResponse>(getToken, `/canvas-nodes/${id}`, { method: "DELETE" }),
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
    listReferences: () => request<ListReferenceImagesResponse>(getToken, "/references"),
    createReference: (body: CreateReferenceImageRequest) =>
      request<ReferenceImage>(getToken, "/references", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    deleteReference: (id: string) =>
      request<DeleteReferenceImageResponse>(getToken, `/references/${id}`, { method: "DELETE" }),
  };
}
