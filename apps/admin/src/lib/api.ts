import { useAuth } from "@clerk/react";
import { useMemo } from "react";
import type {
  AdminGrantCreditsRequest,
  AdminOverviewResponse,
  AdminRendersResponse,
  AdminSettings,
  AdminUpdateSettingsRequest,
  AdminUpdateUserRequest,
  AdminUser,
  AdminUserDetailResponse,
  AdminUsersResponse,
  MeResponse,
  RenderStatus,
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
      listUsers: (params: { search?: string; limit?: number; offset?: number }) =>
        request<AdminUsersResponse>(getToken, `/admin/users${query(params)}`),
      getUser: (id: string) => request<AdminUserDetailResponse>(getToken, `/admin/users/${id}`),
      adjustCredits: (id: string, body: AdminGrantCreditsRequest) =>
        request<{ user: AdminUser }>(getToken, `/admin/users/${id}/credits`, { method: "POST", body: JSON.stringify(body) }),
      updateUser: (id: string, body: AdminUpdateUserRequest) =>
        request<{ user: AdminUser }>(getToken, `/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
      listRenders: (params: { status?: RenderStatus; userId?: string; limit?: number; offset?: number }) =>
        request<AdminRendersResponse>(getToken, `/admin/renders${query(params)}`),
      getSettings: () => request<AdminSettings>(getToken, "/admin/settings"),
      updateSettings: (body: AdminUpdateSettingsRequest) =>
        request<AdminSettings>(getToken, "/admin/settings", { method: "PUT", body: JSON.stringify(body) }),
    }),
    [getToken],
  );
}

export type AdminApi = ReturnType<typeof useAdminApi>;
