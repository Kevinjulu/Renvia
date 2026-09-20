import { useAuth } from "@clerk/react";
import { useMemo } from "react";
import type {
  AdminAuditResponse,
  AdminBulkGrantCreditsRequest,
  AdminBulkGrantCreditsResponse,
  AdminCreditsResponse,
  AdminGrantCreditsRequest,
  AdminOverviewResponse,
  AdminProjectDetailResponse,
  AdminProjectHealth,
  AdminProjectOrder,
  AdminProjectSort,
  AdminProjectsResponse,
  AdminRenderDetailResponse,
  AdminRenderKind,
  AdminRenderOrder,
  AdminRenderSort,
  AdminRendersResponse,
  AdminSegmentationDetailResponse,
  AdminSegmentationMode,
  AdminSegmentationOrder,
  AdminSegmentationSort,
  AdminSegmentationsResponse,
  AdminSettings,
  AdminUpdateSettingsRequest,
  AdminUpdateUserRequest,
  AdminUser,
  AdminUserDetailResponse,
  AdminUserOrder,
  AdminUserSort,
  AdminUsersResponse,
  CreditLedgerReason,
  MeResponse,
  RenderStatus,
  SegmentationStatus,
} from "@renvia/types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** Machine-readable reason from the response body, e.g. "balance_negative". */
    readonly code: string | null,
    message: string,
  ) {
    super(message);
  }
}

type GetToken = () => Promise<string | null>;

async function request<T>(getToken: GetToken, path: string, init?: RequestInit): Promise<T> {
  const token = await getToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init?.body) headers.set("Content-Type", "application/json");

  const response = await fetch(`${API_BASE_URL}/api${path}`, { ...init, headers });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: unknown; code?: unknown } | null;
    throw new ApiError(
      response.status,
      typeof body?.code === "string" ? body.code : null,
      typeof body?.error === "string" ? body.error : `Request failed (${response.status})`,
    );
  }
  return response.json() as Promise<T>;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export function useAdminApi() {
  const { getToken } = useAuth();

  return useMemo(
    () => ({
      getMe: () => request<MeResponse>(getToken, "/me"),
      getOverview: () => request<AdminOverviewResponse>(getToken, "/admin/overview"),
      listUsers: (params: {
        search?: string;
        role?: "user" | "admin";
        status?: "active" | "disabled";
        balance?: "low" | "zero";
        sort?: AdminUserSort;
        order?: AdminUserOrder;
        limit?: number;
        offset?: number;
      }) => request<AdminUsersResponse>(getToken, `/admin/users${query(params)}`),
      getUser: (id: string) => request<AdminUserDetailResponse>(getToken, `/admin/users/${id}`),
      adjustCredits: (id: string, body: AdminGrantCreditsRequest) =>
        request<{ user: AdminUser }>(getToken, `/admin/users/${id}/credits`, { method: "POST", body: JSON.stringify(body) }),
      bulkGrantCredits: (body: AdminBulkGrantCreditsRequest) =>
        request<AdminBulkGrantCreditsResponse>(getToken, "/admin/users/bulk-credits", { method: "POST", body: JSON.stringify(body) }),
      updateUser: (id: string, body: AdminUpdateUserRequest) =>
        request<{ user: AdminUser }>(getToken, `/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
      listRenders: (params: {
        status?: RenderStatus;
        kind?: AdminRenderKind;
        stuck?: boolean;
        search?: string;
        model?: string;
        userId?: string;
        projectId?: string;
        sort?: AdminRenderSort;
        order?: AdminRenderOrder;
        limit?: number;
        offset?: number;
      }) =>
        request<AdminRendersResponse>(
          getToken,
          `/admin/renders${query({
            ...params,
            stuck: params.stuck ? "1" : undefined,
          })}`,
        ),
      getRender: (id: string) => request<AdminRenderDetailResponse>(getToken, `/admin/renders/${id}`),
      listProjects: (params: {
        search?: string;
        health?: AdminProjectHealth;
        sort?: AdminProjectSort;
        order?: AdminProjectOrder;
        limit?: number;
        offset?: number;
      }) => request<AdminProjectsResponse>(getToken, `/admin/projects${query(params)}`),
      getProject: (id: string) => request<AdminProjectDetailResponse>(getToken, `/admin/projects/${id}`),
      listCredits: (params: { reason?: CreditLedgerReason; userId?: string; limit?: number; offset?: number }) =>
        request<AdminCreditsResponse>(getToken, `/admin/credits${query(params)}`),
      listSegmentations: (params: {
        status?: SegmentationStatus;
        mode?: AdminSegmentationMode;
        stuck?: boolean;
        search?: string;
        model?: string;
        userId?: string;
        sort?: AdminSegmentationSort;
        order?: AdminSegmentationOrder;
        limit?: number;
        offset?: number;
      }) =>
        request<AdminSegmentationsResponse>(
          getToken,
          `/admin/segmentations${query({
            ...params,
            stuck: params.stuck ? "1" : undefined,
          })}`,
        ),
      getSegmentation: (id: string) => request<AdminSegmentationDetailResponse>(getToken, `/admin/segmentations/${id}`),
      listAudit: (params: { action?: string; limit?: number; offset?: number }) =>
        request<AdminAuditResponse>(getToken, `/admin/audit${query(params)}`),
      getSettings: () => request<AdminSettings>(getToken, "/admin/settings"),
      updateSettings: (body: AdminUpdateSettingsRequest) =>
        request<AdminSettings>(getToken, "/admin/settings", { method: "PUT", body: JSON.stringify(body) }),
    }),
    [getToken],
  );
}

export type AdminApi = ReturnType<typeof useAdminApi>;
