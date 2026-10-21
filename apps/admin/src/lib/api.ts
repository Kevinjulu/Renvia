import { useAuth } from "@clerk/react";
import { useMemo } from "react";
import type {
  AdminSecurityOverview,
  AdminSecurityQueueResponse,
  AdminFreeAllowanceDecisionRequest,
  AdminFreeAllowanceResponse,
  AdminBetaAnnouncement,
  AdminStockReference,
  AdminStockReferencesResponse,
  SampleCategory,
  AdminBetaEnrollment,
  AdminBetaFeedbackDetail,
  AdminBetaFeedbackListResponse,
  AdminBetaInvitation,
  AdminBetaInvitationCreated,
  AdminBetaMission,
  AdminBetaProgram,
  AdminBetaProgramDetailResponse,
  AdminBetaProgramsResponse,
  AdminUserBetaStatus,
  BetaMissionRule,
  AdminCommercialChangeResponse,
  AdminCreditPackTerms,
  AdminModelsResponse,
  AdminPlanTerms,
  AdminPlansResponse,
  AdminPricingSimulationRequest,
  AdminPricingSimulationResponse,
  CreditPrices,
  AdminCreateMaintenanceWindowRequest,
  AdminMaintenanceWindowResponse,
  AdminPublishStudioConfigRequest,
  AdminPublishStudioConfigResponse,
  AdminStudioControlResponse,
  AdminPerformanceFailuresResponse,
  AdminPerformanceRange,
  AdminPerformanceSummaryResponse,
  AdminPerformanceTimeseriesResponse,
  AdminAuditExportResponse,
  AdminGovernanceResponse,
  AdminRefundResponse,
  AdminUpdateGovernanceRequest,
  AdminApprovalsResponse,
  AdminAuditAction,
  AdminAuditRange,
  AdminAuditResponse,
  AdminBulkGrantCreditsRequest,
  AdminBulkGrantCreditsResponse,
  AdminBillingResponse,
  AdminFinancialsResponse,
  AdminCreditDirection,
  AdminCreditOrder,
  AdminCreditSort,
  AdminIncidentsResponse,
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
  AdminSetPlanRequest,
  AdminUserEntitlement,
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
import { reportClientError } from "../components/AppErrorHandling";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** Machine-readable reason from the response body, e.g. "balance_negative". */
    readonly code: string | null,
    message: string,
    readonly requestId: string | null = null,
  ) {
    super(message);
  }
}

type GetToken = () => Promise<string | null>;

async function request<T>(getToken: GetToken, path: string, init?: RequestInit): Promise<T> {
  try {
    const token = await getToken();
    const headers = new Headers(init?.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    // A File body carries its own image type; everything else sent here is JSON.
    if (typeof init?.body === "string") headers.set("Content-Type", "application/json");
    headers.set("X-Request-Id", crypto.randomUUID());
    const response = await fetch(`${API_BASE_URL}/api${path}`, { ...init, headers });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: unknown; code?: unknown } | null;
      throw new ApiError(
        response.status,
        typeof body?.code === "string" ? body.code : null,
        typeof body?.error === "string" ? body.error : `Request failed (${response.status})`,
        response.headers.get("X-Request-Id"),
      );
    }
    return response.json() as Promise<T>;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status >= 500) reportClientError(error, { requestId: error instanceof ApiError ? error.requestId : null });
    throw error;
  }
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
      // ── Beta program ──
      listBetaPrograms: () => request<AdminBetaProgramsResponse>(getToken, "/admin/beta/programs"),
      getBetaProgram: (id: string) => request<AdminBetaProgramDetailResponse>(getToken, `/admin/beta/programs/${id}`),
      createBetaProgram: (body: Record<string, unknown>) => request<AdminBetaProgram>(getToken, "/admin/beta/programs", { method: "POST", body: JSON.stringify(body) }),
      deleteBetaProgram: (id: string) =>
        request<{ deleted: true; testers: number; reports: number; screenshotsDeleted: number }>(getToken, `/admin/beta/programs/${id}`, { method: "DELETE" }),
      updateBetaProgram: (id: string, body: Record<string, unknown>) => request<AdminBetaProgram>(getToken, `/admin/beta/programs/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
      setBetaProgramStatus: (id: string, status: "active" | "paused" | "ended", reason: string) =>
        request<AdminBetaProgram>(getToken, `/admin/beta/programs/${id}/status`, { method: "POST", body: JSON.stringify({ status, reason }) }),
      setBetaBudget: (id: string, budgetUsd: number, reason: string) =>
        request<AdminBetaProgram | { pendingApproval: true; approvalId: string }>(getToken, `/admin/beta/programs/${id}/budget`, { method: "POST", body: JSON.stringify({ budgetUsd, reason }) }),
      inviteBetaTester: (programId: string, body: Record<string, unknown>) =>
        request<AdminBetaInvitationCreated>(getToken, `/admin/beta/programs/${programId}/invitations`, { method: "POST", body: JSON.stringify(body) }),
      inviteBetaTestersBulk: (programId: string, body: { emails?: string[]; userIds?: string[]; sendEmail: boolean; cohort?: string | null; creditsOverride?: number | null; expiresInDays?: number }) =>
        request<{ results: ({ email: string; userId?: string; ok: true } & AdminBetaInvitationCreated | { email: string; userId?: string; ok: false; error: string; code: string })[] }>(getToken, `/admin/beta/programs/${programId}/invitations/bulk`, { method: "POST", body: JSON.stringify(body) }),
      getUserBetaStatus: (userId: string) => request<AdminUserBetaStatus>(getToken, `/admin/beta/users/${userId}`),
      getSecurityOverview: () => request<AdminSecurityOverview>(getToken, "/admin/security/overview"),
      getSecurityQueue: (status: "review_required" | "verification_required" | "denied", limit: number, offset: number) =>
        request<AdminSecurityQueueResponse>(getToken, `/admin/security/queue?status=${status}&limit=${limit}&offset=${offset}`),
      getUserFreeAllowance: (userId: string) => request<AdminFreeAllowanceResponse>(getToken, `/admin/users/${userId}/free-allowance`),
      decideUserFreeAllowance: (userId: string, body: AdminFreeAllowanceDecisionRequest) =>
        request<AdminFreeAllowanceResponse & { granted: boolean }>(getToken, `/admin/users/${userId}/free-allowance`, { method: "POST", body: JSON.stringify(body) }),
      revokeBetaInvitation: (id: string, reason: string) => request<AdminBetaInvitation>(getToken, `/admin/beta/invitations/${id}/revoke`, { method: "POST", body: JSON.stringify({ reason }) }),
      setBetaEnrollmentStatus: (id: string, status: "active" | "suspended" | "completed" | "revoked", reason: string) =>
        request<AdminBetaEnrollment>(getToken, `/admin/beta/enrollments/${id}/status`, { method: "POST", body: JSON.stringify({ status, reason }) }),
      extendBetaEnrollment: (id: string, endsAt: string | null, reason: string) =>
        request<AdminBetaEnrollment>(getToken, `/admin/beta/enrollments/${id}/extend`, { method: "POST", body: JSON.stringify({ endsAt, reason }) }),
      grantBetaCredits: (programId: string, body: { enrollmentIds: string[]; amount: number; note: string; idempotencyKey: string }) =>
        request<{ results: { enrollmentId: string; status: string; reason?: string }[] } | { pendingApproval: true; approvalId: string }>(getToken, `/admin/beta/programs/${programId}/grant`, { method: "POST", body: JSON.stringify(body) }),
      createBetaMission: (programId: string, body: { title: string; instructions: string; rule: BetaMissionRule; required: boolean; position: number }) =>
        request<AdminBetaMission>(getToken, `/admin/beta/programs/${programId}/missions`, { method: "POST", body: JSON.stringify(body) }),
      deleteBetaMission: (id: string) => request<{ deleted: true }>(getToken, `/admin/beta/missions/${id}`, { method: "DELETE" }),
      createBetaAnnouncement: (programId: string, body: { title: string; body: string; severity: "info" | "important" }) =>
        request<AdminBetaAnnouncement>(getToken, `/admin/beta/programs/${programId}/announcements`, { method: "POST", body: JSON.stringify(body) }),
      deleteBetaAnnouncement: (id: string) => request<{ deleted: true }>(getToken, `/admin/beta/announcements/${id}`, { method: "DELETE" }),
      listBetaFeedback: (params: { programId?: string; status?: string; category?: string; severity?: string; knownIssue?: string; assigneeId?: string; page?: number }) =>
        request<AdminBetaFeedbackListResponse>(getToken, `/admin/beta/feedback${query(params)}`),
      getBetaFeedback: (id: string) => request<AdminBetaFeedbackDetail>(getToken, `/admin/beta/feedback/${id}`),
      listStockReferences: () => request<AdminStockReferencesResponse>(getToken, "/admin/library"),
      uploadStockReference: (category: SampleCategory, file: File, caption: string) =>
        request<AdminStockReference>(getToken, `/admin/library/${category}${query({ caption: caption.trim() })}`, { method: "POST", body: file }),
      updateStockReference: (id: string, body: { caption?: string; hidden?: boolean }) =>
        request<AdminStockReference>(getToken, `/admin/library/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
      orderStockReferences: (category: SampleCategory, ids: string[]) =>
        request<{ ok: true }>(getToken, `/admin/library/order/${category}`, { method: "POST", body: JSON.stringify({ ids }) }),
      deleteStockReference: (id: string) => request<{ deleted: true }>(getToken, `/admin/library/${id}`, { method: "DELETE" }),
      updateBetaFeedback: (id: string, body: Record<string, unknown>) => request<AdminBetaFeedbackDetail>(getToken, `/admin/beta/feedback/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
      commentBetaFeedback: (id: string, body: string, visibility: "tester" | "internal") =>
        request<AdminBetaFeedbackDetail>(getToken, `/admin/beta/feedback/${id}/comments`, { method: "POST", body: JSON.stringify({ body, visibility }) }),
      requestBetaFeedbackInfo: (id: string, body: string) => request<AdminBetaFeedbackDetail>(getToken, `/admin/beta/feedback/${id}/request-info`, { method: "POST", body: JSON.stringify({ body }) }),
      markBetaFeedbackDuplicate: (id: string, of: string) => request<AdminBetaFeedbackDetail>(getToken, `/admin/beta/feedback/${id}/duplicate`, { method: "POST", body: JSON.stringify({ of }) }),
      listUsers: (params: {
        search?: string;
        role?: "user" | "analyst" | "support" | "billing" | "admin";
        status?: "active" | "disabled";
        balance?: "low" | "zero";
        sort?: AdminUserSort;
        order?: AdminUserOrder;
        limit?: number;
        offset?: number;
      }) => request<AdminUsersResponse>(getToken, `/admin/users${query(params)}`),
      getUser: (id: string) => request<AdminUserDetailResponse>(getToken, `/admin/users/${id}`),
      addCustomerNote: (id: string, body: string) => request<{ id: string }>(getToken, `/admin/users/${id}/notes`, { method: "POST", body: JSON.stringify({ body }) }),
      addCustomerTag: (id: string, label: string) => request<{ ok: true }>(getToken, `/admin/users/${id}/tags`, { method: "POST", body: JSON.stringify({ label }) }),
      revokeUserSessions: (id: string, body: { reason: string; confirmEmail: string }) => request<{ revoked: number }>(getToken, `/admin/users/${id}/revoke-sessions`, { method: "POST", body: JSON.stringify(body) }),
      setUserPlan: (id: string, body: AdminSetPlanRequest) =>
        request<{ entitlement: AdminUserEntitlement }>(getToken, `/admin/users/${id}/plan`, { method: "PUT", body: JSON.stringify(body) }),
      clearUserPlan: (id: string, reason: string) =>
        request<{ entitlement: AdminUserEntitlement }>(getToken, `/admin/users/${id}/plan/clear`, { method: "POST", body: JSON.stringify({ reason }) }),
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
      refreshRender: (id: string) => request<AdminRenderDetailResponse>(getToken, `/admin/renders/${id}/refresh`, { method: "POST" }),
      cancelRender: (id: string) => request<AdminRenderDetailResponse>(getToken, `/admin/renders/${id}/cancel`, { method: "POST" }),
      listProjects: (params: {
        search?: string;
        health?: AdminProjectHealth;
        sort?: AdminProjectSort;
        order?: AdminProjectOrder;
        limit?: number;
        offset?: number;
      }) => request<AdminProjectsResponse>(getToken, `/admin/projects${query(params)}`),
      getProject: (id: string) => request<AdminProjectDetailResponse>(getToken, `/admin/projects/${id}`),
      listCredits: (params: {
        reason?: CreditLedgerReason;
        direction?: AdminCreditDirection;
        search?: string;
        userId?: string;
        sort?: AdminCreditSort;
        order?: AdminCreditOrder;
        limit?: number;
        offset?: number;
      }) => request<AdminCreditsResponse>(getToken, `/admin/credits${query(params)}`),
      getBilling: () => request<AdminBillingResponse>(getToken, "/admin/billing"),
      getFinancials: () => request<AdminFinancialsResponse>(getToken, "/admin/financials"),
      listApprovals: () => request<AdminApprovalsResponse>(getToken, "/admin/approvals"),
      approveApproval: (id: string, note?: string) => request<{ id: string; status: "approved" }>(getToken, `/admin/approvals/${id}/approve`, { method: "POST", body: JSON.stringify({ note }) }),
      rejectApproval: (id: string, note: string) => request<{ id: string; status: "rejected" }>(getToken, `/admin/approvals/${id}/reject`, { method: "POST", body: JSON.stringify({ note }) }),
      executeApproval: (id: string) => request<{ id: string; status: "executed" }>(getToken, `/admin/approvals/${id}/execute`, { method: "POST", body: JSON.stringify({}) }),
      getIncidents: (status?: "open" | "acknowledged" | "resolved") => request<AdminIncidentsResponse>(getToken, `/admin/incidents${status ? `?status=${status}` : ""}`),
      syncIncidents: () => request<{ opened: number }>(getToken, "/admin/incidents/sync", { method: "POST" }),
      assignIncident: (id: string, ownerId: string | null) => request<{ id: string; ownerId: string | null }>(getToken, `/admin/incidents/${id}/assign`, { method: "POST", body: JSON.stringify({ ownerId }) }),
      acknowledgeIncident: (id: string, note?: string) => request<{ id: string; status: "acknowledged" }>(getToken, `/admin/incidents/${id}/acknowledge`, { method: "POST", body: JSON.stringify({ note }) }),
      updateIncidentSeverity: (id: string, severity: "low" | "medium" | "high" | "critical") => request<{ id: string; severity: string }>(getToken, `/admin/incidents/${id}/severity`, { method: "POST", body: JSON.stringify({ severity }) }),
      resolveIncident: (id: string, note: string) => request<{ id: string; status: "resolved" }>(getToken, `/admin/incidents/${id}/resolve`, { method: "POST", body: JSON.stringify({ note }) }),
      notifyIncident: (id: string) => request<{ id: string; notification: string }>(getToken, `/admin/incidents/${id}/notify`, { method: "POST" }),
      refundPayment: (id: string, reason?: string) => request<AdminRefundResponse>(getToken, `/admin/billing/payments/${id}/refund`, { method: "POST", body: JSON.stringify(reason ? { reason } : {}) }),
      replayBillingWebhook: (id: string) => request<{ id: string; status: "processed" }>(getToken, `/admin/billing/webhooks/${id}/replay`, { method: "POST" }),
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
      recoverSegmentation: (id: string) => request<AdminSegmentationDetailResponse>(getToken, `/admin/segmentations/${id}/recover`, { method: "POST" }),
      listAudit: (params: {
        action?: AdminAuditAction;
        actorId?: string;
        range?: AdminAuditRange;
        search?: string;
        limit?: number;
        offset?: number;
      }) => request<AdminAuditResponse>(getToken, `/admin/audit${query(params)}`),
      createAuditExport: (reason: string) => request<AdminAuditExportResponse>(getToken, "/admin/audit/exports", { method: "POST", body: JSON.stringify({ reason }) }),
      /** The stored CSV exactly as exported, with the digest the server recorded for it. */
      downloadAuditExport: async (id: string) => {
        const token = await getToken();
        const response = await fetch(`${API_BASE_URL}/api/admin/audit/exports/${id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!response.ok) throw new ApiError(response.status, null, `Download failed (${response.status})`, response.headers.get("X-Request-Id"));
        return { blob: await response.blob(), sha256: response.headers.get("X-Content-SHA256") };
      },
      getGovernance: () => request<AdminGovernanceResponse>(getToken, "/admin/governance"),
      updateGovernance: (body: AdminUpdateGovernanceRequest) =>
        request<AdminGovernanceResponse["settings"]>(getToken, "/admin/governance", { method: "PUT", body: JSON.stringify(body) }),
      getPerformanceSummary: (range: AdminPerformanceRange) => request<AdminPerformanceSummaryResponse>(getToken, `/admin/performance/summary${query({ range })}`),
      getPerformanceTimeseries: (range: AdminPerformanceRange) => request<AdminPerformanceTimeseriesResponse>(getToken, `/admin/performance/timeseries${query({ range })}`),
      getPerformanceFailures: (range: AdminPerformanceRange) => request<AdminPerformanceFailuresResponse>(getToken, `/admin/performance/failures${query({ range })}`),
      getStudioControl: () => request<AdminStudioControlResponse>(getToken, "/admin/studio-control"),
      publishStudioConfig: (body: AdminPublishStudioConfigRequest) =>
        request<AdminPublishStudioConfigResponse>(getToken, "/admin/studio-control/publish", { method: "POST", body: JSON.stringify(body) }),
      restoreStudioConfig: (body: { version: number; expectedVersion: number; reason: string }) =>
        request<AdminPublishStudioConfigResponse>(getToken, "/admin/studio-control/restore", { method: "POST", body: JSON.stringify(body) }),
      createMaintenanceWindow: (body: AdminCreateMaintenanceWindowRequest) =>
        request<AdminMaintenanceWindowResponse>(getToken, "/admin/maintenance-windows", { method: "POST", body: JSON.stringify(body) }),
      cancelMaintenanceWindow: (id: string, reason: string) =>
        request<AdminMaintenanceWindowResponse>(getToken, `/admin/maintenance-windows/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }),
      getModels: () => request<AdminModelsResponse>(getToken, "/admin/models"),
      holdModel: (body: { modelId: string; paused: boolean; message: string | null; expectedVersion: number; reason: string }) =>
        request<AdminPublishStudioConfigResponse>(getToken, "/admin/models/hold", { method: "POST", body: JSON.stringify(body) }),
      getPlans: () => request<AdminPlansResponse>(getToken, "/admin/plans"),
      updatePlan: (id: string, body: { expectedVersion: number; terms: Omit<AdminPlanTerms, "currency" | "interval">; reason: string }) =>
        request<AdminCommercialChangeResponse>(getToken, `/admin/plans/${id}`, { method: "PUT", body: JSON.stringify(body) }),
      createCreditPack: (body: { sku: string; terms: Omit<AdminCreditPackTerms, "currency">; reason: string }) =>
        request<AdminCommercialChangeResponse>(getToken, "/admin/credit-packs", { method: "POST", body: JSON.stringify(body) }),
      updateCreditPack: (id: string, body: { expectedVersion: number; terms: Omit<AdminCreditPackTerms, "currency">; reason: string }) =>
        request<AdminCommercialChangeResponse>(getToken, `/admin/credit-packs/${id}`, { method: "PUT", body: JSON.stringify(body) }),
      publishCreditPrices: (body: { expectedVersion: number; prices: CreditPrices | null; reason: string }) =>
        request<AdminPublishStudioConfigResponse>(getToken, "/admin/pricing/credits", { method: "PUT", body: JSON.stringify(body) }),
      simulatePricing: (body: AdminPricingSimulationRequest) =>
        request<AdminPricingSimulationResponse>(getToken, "/admin/pricing/simulate", { method: "POST", body: JSON.stringify(body) }),
      getSettings: () => request<AdminSettings>(getToken, "/admin/settings"),
      updateSettings: (body: AdminUpdateSettingsRequest) =>
        request<AdminSettings>(getToken, "/admin/settings", { method: "PUT", body: JSON.stringify(body) }),
    }),
    [getToken],
  );
}

export type AdminApi = ReturnType<typeof useAdminApi>;
