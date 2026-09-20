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
  /** Credits debited for this render (refunded if it failed); 0 for admins. */
  creditsCharged: number;
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
  /**
   * White-on-black PNG at the source image's size; white marks the area to edit.
   * Only that area of the model's output is pasted back onto the source.
   */
  maskImageUrl?: string;
}

/** Which model family serves a job. */
export type RenderRoute = RenderSourceType | "references" | "edit" | "edit-references";

export function renderRouteFor(settings: RenderGenerationSettings): RenderRoute {
  const hasReferences = (settings.referenceImageUrls?.length ?? 0) > 0;
  if (settings.edit) return hasReferences ? "edit-references" : "edit";
  return hasReferences ? "references" : (settings.sourceType ?? "photo");
}

export interface RenderBudgetResponse {
  mode: RenderEngineMode;
  /** Estimated USD per image for each route in the current mode. */
  pricing: Record<RenderRoute, number>;
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

export type UserRole = "user" | "admin";

/** Every model currently costs ~$0.04 per image, so credits map 1:1 to images. */
export const CREDITS_PER_IMAGE = 1;

/** Credits for one automatic selection (click or text) while editing a render. */
export const CREDITS_PER_SELECTION = 1;

export type CreditLedgerReason =
  | "signup_bonus"
  | "initial_grant"
  | "admin_grant"
  | "render"
  | "render_refund"
  | "segment"
  | "segment_refund"
  | "purchase";

export interface CreditLedgerEntry {
  id: string;
  /** Positive for grants and refunds, negative for spending. */
  amount: number;
  reason: CreditLedgerReason;
  renderId: string | null;
  segmentationId?: string | null;
  note: string | null;
  createdAt: string;
}

/** Automatic selection on an image: text ("windows") and/or a clicked point, in image pixels. */
export interface CreateSegmentationRequest {
  imageUrl: string;
  prompt?: string;
  point?: { x: number; y: number };
}

export interface CreateSegmentationResponse {
  /** White-on-black PNG data URL at the image's natural size; white is selected. */
  maskDataUrl: string;
  /** Objects found; 0 means nothing matched and the credit was refunded. */
  objectCount: number;
  creditsCharged: number;
}

export interface MeCreditsResponse {
  creditBalance: number;
  /** Most recent first. */
  entries: CreditLedgerEntry[];
}

export interface MeResponse {
  id: string;
  clerkId: string;
  email: string;
  role: UserRole;
  /** Spendable credits; 1 credit = 1 image. Admins aren't charged. */
  creditBalance: number;
  disabled: boolean;
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

// ── Admin API (/api/admin/*, admins only) ────────────────────────────────────────

export interface AdminUser {
  id: string;
  clerkId: string;
  email: string;
  role: UserRole;
  creditBalance: number;
  disabled: boolean;
  createdAt: string;
  /** Renders and edits that didn't fail. */
  renderCount: number;
  /** Estimated fal spend for this user's non-failed renders. */
  spentUsd: number;
  lastRenderAt: string | null;
}

export interface AdminUsersResponse {
  users: AdminUser[];
  total: number;
  summary: {
    total: number;
    admins: number;
    disabled: number;
    /** Non-admin users with fewer than 5 credits. */
    lowBalance: number;
  };
}

export type AdminUserSort = "createdAt" | "lastRenderAt" | "creditBalance" | "renderCount" | "spentUsd";
export type AdminUserOrder = "asc" | "desc";

export interface AdminBulkGrantCreditsRequest {
  userIds: string[];
  /** Positive credits to grant to each selected user. */
  amount: number;
  note: string;
}

export interface AdminBulkGrantCreditsResponse {
  updated: number;
}

export interface AdminLedgerEntry extends CreditLedgerEntry {
  /** Admin who made a manual adjustment, if any. */
  actorEmail: string | null;
}

export interface AdminRender {
  id: string;
  kind: "render" | "edit";
  status: RenderStatus;
  model: string | null;
  costUsd: number;
  creditsCharged: number;
  prompt: string;
  style: string;
  viewLabel: string | null;
  sourceImageUrl: string;
  resultImageUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
  projectName: string;
  userId: string;
  userEmail: string;
}

export interface AdminRendersResponse {
  renders: AdminRender[];
  total: number;
}

export interface AdminUserDetailResponse {
  user: AdminUser;
  ledger: AdminLedgerEntry[];
  renders: AdminRender[];
}

export interface AdminGrantCreditsRequest {
  /** Positive to grant, negative to remove; a removal can't take the balance below 0. */
  amount: number;
  note: string;
}

export interface AdminUpdateUserRequest {
  disabled?: boolean;
  role?: UserRole;
}

export interface AdminOverviewResponse {
  users: { total: number; newLast7Days: number; disabled: number };
  renders: {
    total: number;
    today: number;
    byStatus: Record<RenderStatus, number>;
    failureRate: number;
    /** Renders stuck in pending/processing longer than 15 minutes (UTC). */
    stuckCount: number;
  };
  spend: {
    mode: RenderEngineMode;
    spentUsd: number;
    budgetUsd: number;
    byModel: { model: string; renders: number; spentUsd: number }[];
  };
  /** Credits currently held by users, and all-time granted/spent. */
  credits: { outstanding: number; granted: number; spent: number };
  /** Last 14 UTC days, oldest first. */
  daily: { date: string; renders: number; spentUsd: number }[];
  topUsers: { id: string; email: string; renders: number; spentUsd: number }[];
  projects: { total: number; activeLast7Days: number };
  segmentations: {
    total: number;
    today: number;
    byStatus: Record<"pending" | "succeeded" | "failed", number>;
    failureRate: number;
    spentUsd: number;
  };
  /** Newest failed renders first — for triage on the Overview. */
  recentFailures: {
    id: string;
    kind: "render" | "edit";
    userId: string;
    userEmail: string;
    projectName: string;
    errorMessage: string | null;
    sourceImageUrl: string;
    createdAt: string;
  }[];
  /** Derived operator alerts from live thresholds. */
  alerts: {
    id: "budget_warning" | "budget_critical" | "failure_rate" | "stuck_renders" | "engine_mode";
    severity: "warning" | "critical" | "info";
    message: string;
    href: string;
  }[];
}

export interface AdminSettings {
  signupBonusCredits: number;
  /** Max renders per non-admin user per UTC day; null = unlimited. */
  dailyRenderLimit: number | null;
  /** Null = use the FAL_MODE env var. */
  falMode: RenderEngineMode | null;
  /** Null = use the FAL_BUDGET_USD env var. */
  falBudgetUsd: number | null;
  /** What's actually in force after env fallbacks. */
  effectiveMode: RenderEngineMode;
  effectiveBudgetUsd: number;
  updatedAt: string;
}

export type AdminUpdateSettingsRequest = Partial<
  Pick<AdminSettings, "signupBonusCredits" | "dailyRenderLimit" | "falMode" | "falBudgetUsd">
>;

export interface AdminProject {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  ownerId: string;
  ownerEmail: string;
  /** Non-failed renders (succeeded + in flight). */
  renderCount: number;
  failedCount: number;
  /** pending + processing. */
  inFlightCount: number;
  spentUsd: number;
  lastRenderAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AdminProjectHealth = "active" | "failures" | "inflight" | "never" | "high_spend";
export type AdminProjectSort = "updatedAt" | "createdAt" | "lastRenderAt" | "renderCount" | "spentUsd" | "failedCount";
export type AdminProjectOrder = "asc" | "desc";

export interface AdminProjectsResponse {
  projects: AdminProject[];
  total: number;
  summary: {
    total: number;
    activeLast7Days: number;
    withFailures: number;
    neverRendered: number;
    spentUsd: number;
  };
}

export interface AdminProjectDetailResponse {
  project: AdminProject;
  renders: AdminRender[];
}

export interface AdminCreditEntry {
  id: string;
  userId: string;
  userEmail: string;
  amount: number;
  reason: CreditLedgerReason;
  renderId: string | null;
  segmentationId: string | null;
  note: string | null;
  actorEmail: string | null;
  createdAt: string;
}

export interface AdminCreditsResponse {
  entries: AdminCreditEntry[];
  total: number;
}

export type SegmentationStatus = "pending" | "succeeded" | "failed";

export interface AdminSegmentation {
  id: string;
  userId: string;
  userEmail: string;
  imageUrl: string;
  prompt: string | null;
  point: { x: number; y: number } | null;
  status: SegmentationStatus;
  objectCount: number | null;
  model: string;
  costUsd: number;
  creditsCharged: number;
  errorMessage: string | null;
  createdAt: string;
}

export interface AdminSegmentationsResponse {
  segmentations: AdminSegmentation[];
  total: number;
}

export type AdminAuditAction = "credits.adjust" | "user.update" | "settings.update";

export interface AdminAuditEvent {
  id: string;
  actorId: string;
  actorEmail: string;
  action: AdminAuditAction;
  targetType: string;
  targetId: string | null;
  summary: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface AdminAuditResponse {
  events: AdminAuditEvent[];
  total: number;
}
