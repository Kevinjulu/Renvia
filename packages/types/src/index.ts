export type RenderStatus = "pending" | "processing" | "succeeded" | "failed";

export interface RenderJob {
  id: string;
  projectId: string;
  status: RenderStatus;
  sourceImageUrl: string;
  resultImageUrl: string | null;
  prompt: string;
  /** "auto" (match source) or a fixed W:H ratio — see AspectRatio. */
  aspectRatio: string;
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
  /**
   * The seed actually used — what was requested, or what the model echoed back when none
   * was. Null when the model doesn't report one and none was requested, so this exact
   * result can't be reproduced (currently true for nano-banana/edit's reference route).
   */
  seed: number | null;
  createdAt: string;
  updatedAt: string;
}

/** "auto" matches the source image; the rest ask the model for a fixed output shape. */
export type AspectRatio = "auto" | "1:1" | "16:9" | "4:3" | "3:4" | "9:16";

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
  /** Credits charged per render/edit image (from admin settings). */
  creditsPerImage: number;
  /** When true, non-admin renders are paused. */
  maintenanceRenders: boolean;
  /** Optional operator message while maintenance is on. */
  maintenanceMessage: string | null;
}

/** Optional generation knobs, mapped onto model inputs by the API's model registry. */
export interface RenderGenerationSettings {
  sourceType?: RenderSourceType;
  /** Render-tab strength, 1 (subtle) – 4 (maximum). Ignored on edit routes — see editInfluence. */
  styleInfluence?: number;
  /** Edit-tab strength, 1 (subtle) – 4 (maximum). How closely the edit follows the instruction. */
  editInfluence?: number;
  preserveStructure?: boolean;
  referenceImageUrls?: string[];
  edit?: RenderEditSettings;
  /** Reuse a previous render's seed to reproduce it, or nudge it with a new prompt/strength. */
  seed?: number;
}

export interface CreateRenderRequest {
  projectId: string;
  sourceImageUrl: string;
  prompt: string;
  aspectRatio: AspectRatio;
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

/** Why a render or selection was refused. Drives the studio's limit dialog. */
export type LimitCode =
  | "insufficient_credits"
  | "daily_limit_reached"
  | "monthly_limit_reached"
  | "budget_exhausted"
  | "maintenance"
  | "account_disabled"
  | "project_limit_reached"
  | "prompt_too_long"
  | "too_many_references"
  | "upload_too_large";

/** Everything the caller is allowed, after per-user overrides and global settings. */
export interface UserLimits {
  /** null = unlimited. */
  dailyRenders: number | null;
  dailySegments: number | null;
  monthlyRenders: number | null;
  monthlySegments: number | null;
  maxProjects: number | null;
  maxCreditBalance: number | null;
  maxUploadMb: number;
  maxReferenceImages: number;
  maxPromptChars: number;
  maxSelectionPromptChars: number;
  lowCreditThreshold: number;
  /** True when the user skips daily/monthly caps and maintenance pauses (admins and exempt users). */
  exempt: boolean;
  /** Which of the daily/monthly caps came from a per-user override rather than the global setting. */
  overridden: { dailyRenders: boolean; dailySegments: boolean; monthlyRenders: boolean; monthlySegments: boolean };
}

/** Consumption against `UserLimits`, counted in UTC and excluding failed (refunded) work. */
export interface UserUsage {
  rendersToday: number;
  segmentsToday: number;
  rendersThisMonth: number;
  segmentsThisMonth: number;
  projects: number;
}

export interface MeResponse {
  id: string;
  clerkId: string;
  email: string;
  role: UserRole;
  /** Spendable credits; 1 credit = 1 image. Admins aren't charged. */
  creditBalance: number;
  disabled: boolean;
  /** Credits charged per render/edit image (from admin settings). */
  creditsPerImage: number;
  /** Credits charged per automatic selection (from admin settings). */
  creditsPerSelection: number;
  /** When true, non-admin renders are paused. */
  maintenanceRenders: boolean;
  /** When true, non-admin automatic selections are paused. */
  maintenanceSegments: boolean;
  /** Optional operator message while maintenance is on. */
  maintenanceMessage: string | null;
  /** What this user may do right now. */
  limits: UserLimits;
  /** What they've used against those limits today and this month. */
  usage: UserUsage;
  /** Operator-authored refusal copy; a null entry means use the studio's built-in wording. */
  limitMessages: Partial<Record<LimitCode, string | null>>;
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
  /** Per-user limit overrides; null = inherit the global setting. */
  dailyRenderLimitOverride: number | null;
  dailySegmentLimitOverride: number | null;
  monthlyRenderLimitOverride: number | null;
  monthlySegmentLimitOverride: number | null;
  /** Skips daily/monthly caps and maintenance pauses; still charged and still budget-capped. */
  limitsExempt: boolean;
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
  aspectRatio: string;
  viewLabel: string | null;
  sourceImageUrl: string;
  resultImageUrl: string | null;
  errorMessage: string | null;
  falRequestId: string | null;
  seed: number | null;
  /** True when pending/processing longer than 15 minutes. */
  stuck: boolean;
  createdAt: string;
  updatedAt: string;
  projectId: string;
  projectName: string;
  userId: string;
  userEmail: string;
}

export type AdminRenderKind = "render" | "edit";
export type AdminRenderSort = "createdAt" | "costUsd" | "creditsCharged";
export type AdminRenderOrder = "asc" | "desc";

export interface AdminRendersResponse {
  renders: AdminRender[];
  total: number;
  summary: {
    total: number;
    byStatus: Record<RenderStatus, number>;
    inFlight: number;
    stuckCount: number;
    stuckTimeoutMinutes: number;
    failed: number;
    spentUsd: number;
    /** Distinct models with render counts, highest first (for filter chips). */
    models: { model: string; count: number }[];
  };
}

export interface AdminRenderDetailResponse {
  render: AdminRender;
}

export interface AdminUserDetailResponse {
  user: AdminUser;
  ledger: AdminLedgerEntry[];
  renders: AdminRender[];
  /** What this user is actually allowed right now, after overrides and global settings. */
  limits: UserLimits;
  /** This user's consumption against those limits. */
  usage: UserUsage;
}

export interface AdminGrantCreditsRequest {
  /** Positive to grant, negative to remove; a removal can't take the balance below 0. */
  amount: number;
  note: string;
}

export interface AdminUpdateUserRequest {
  disabled?: boolean;
  role?: UserRole;
  /** Null clears the override so the user falls back to the global setting. */
  dailyRenderLimitOverride?: number | null;
  dailySegmentLimitOverride?: number | null;
  monthlyRenderLimitOverride?: number | null;
  monthlySegmentLimitOverride?: number | null;
  limitsExempt?: boolean;
  /**
   * Required when changing role. Must match the target user's email exactly
   * (case-insensitive) so promotions can't happen from a mis-click alone.
   */
  confirmEmail?: string;
}

export interface AdminOverviewResponse {
  users: { total: number; newLast7Days: number; disabled: number };
  renders: {
    total: number;
    today: number;
    byStatus: Record<RenderStatus, number>;
    failureRate: number;
    /** Renders stuck in pending/processing longer than stuckTimeoutMinutes (UTC). */
    stuckCount: number;
    stuckTimeoutMinutes: number;
  };
  spend: {
    mode: RenderEngineMode;
    spentUsd: number;
    budgetUsd: number;
    budgetWarningPercent: number;
    budgetCriticalPercent: number;
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
    id: "budget_warning" | "budget_critical" | "failure_rate" | "stuck_renders" | "engine_mode" | "maintenance";
    severity: "warning" | "critical" | "info";
    message: string;
    href: string;
  }[];
}

export interface AdminSettings {
  signupBonusCredits: number;
  /** Max renders per non-admin user per UTC day; null = unlimited. */
  dailyRenderLimit: number | null;
  /** Max segmentations per non-admin user per UTC day; null = unlimited. */
  dailySegmentLimit: number | null;
  /** Max renders per non-admin user per UTC calendar month; null = unlimited. */
  monthlyRenderLimit: number | null;
  /** Max segmentations per non-admin user per UTC calendar month; null = unlimited. */
  monthlySegmentLimit: number | null;
  /** Ceiling on a non-admin's credit balance — grants clamp to it. Null = uncapped. */
  maxCreditBalance: number | null;
  /** Max projects a non-admin may own; null = unlimited. */
  maxProjectsPerUser: number | null;
  maxUploadMb: number;
  maxReferenceImages: number;
  maxPromptChars: number;
  maxSelectionPromptChars: number;
  /** Studio warns at or below this balance; 0 disables the warning. */
  lowCreditThreshold: number;
  /** Operator copy per refusal; null falls back to the studio's built-in wording. */
  messageInsufficientCredits: string | null;
  messageDailyLimit: string | null;
  messageMonthlyLimit: string | null;
  messageBudgetExhausted: string | null;
  messageAccountDisabled: string | null;
  creditsPerImage: number;
  creditsPerSelection: number;
  maintenanceRenders: boolean;
  maintenanceSegments: boolean;
  maintenanceMessage: string | null;
  budgetWarningPercent: number;
  budgetCriticalPercent: number;
  stuckTimeoutMinutes: number;
  /** Null = use the FAL_MODE env var. */
  falMode: RenderEngineMode | null;
  /** Null = use the FAL_BUDGET_USD env var. */
  falBudgetUsd: number | null;
  /** What's actually in force after env fallbacks. */
  effectiveMode: RenderEngineMode;
  effectiveBudgetUsd: number;
  /** Non-failed render+segment spend against the fal budget. */
  spentUsd: number;
  /** Raw FAL_MODE env (no secrets) — used when falMode is null. */
  envMode: string | null;
  /** Raw FAL_BUDGET_USD env parsed as a number, or null if unset/invalid. */
  envBudgetUsd: number | null;
  /** Read-only ops health — no secrets. */
  health: {
    falKeyConfigured: boolean;
    storageConfigured: boolean;
  };
  /** Effective mode's model id + USD price per render route. */
  models: { route: RenderRoute; modelId: string; costUsd: number }[];
  updatedAt: string;
  updatedByEmail: string | null;
  /** Newest settings.update audit events. */
  recentChanges: {
    id: string;
    actorEmail: string;
    summary: string;
    detail: Record<string, unknown> | null;
    createdAt: string;
  }[];
}

export type AdminUpdateSettingsRequest = Partial<
  Pick<
    AdminSettings,
    | "signupBonusCredits"
    | "dailyRenderLimit"
    | "dailySegmentLimit"
    | "monthlyRenderLimit"
    | "monthlySegmentLimit"
    | "maxCreditBalance"
    | "maxProjectsPerUser"
    | "maxUploadMb"
    | "maxReferenceImages"
    | "maxPromptChars"
    | "maxSelectionPromptChars"
    | "lowCreditThreshold"
    | "messageInsufficientCredits"
    | "messageDailyLimit"
    | "messageMonthlyLimit"
    | "messageBudgetExhausted"
    | "messageAccountDisabled"
    | "creditsPerImage"
    | "creditsPerSelection"
    | "maintenanceRenders"
    | "maintenanceSegments"
    | "maintenanceMessage"
    | "budgetWarningPercent"
    | "budgetCriticalPercent"
    | "stuckTimeoutMinutes"
    | "falMode"
    | "falBudgetUsd"
  >
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

export type AdminCreditDirection = "in" | "out";
export type AdminCreditSort = "createdAt" | "amount";
export type AdminCreditOrder = "asc" | "desc";

export interface AdminCreditsResponse {
  entries: AdminCreditEntry[];
  total: number;
  summary: {
    outstanding: number;
    granted: number;
    spent: number;
    /** Net ledger movement in the last 7 days (grants − spends). */
    netLast7Days: number;
    byReason: { reason: CreditLedgerReason; count: number; totalAmount: number }[];
  };
}

export type SegmentationStatus = "pending" | "succeeded" | "failed";

export type AdminSegmentationMode = "prompt" | "click";
export type AdminSegmentationSort = "createdAt" | "costUsd" | "creditsCharged" | "objectCount";
export type AdminSegmentationOrder = "asc" | "desc";

export interface AdminSegmentation {
  id: string;
  userId: string;
  userEmail: string;
  imageUrl: string;
  prompt: string | null;
  point: { x: number; y: number } | null;
  /** prompt text selection vs click selection. */
  mode: AdminSegmentationMode;
  status: SegmentationStatus;
  objectCount: number | null;
  model: string;
  costUsd: number;
  creditsCharged: number;
  errorMessage: string | null;
  /** True when pending longer than 15 minutes. */
  stuck: boolean;
  createdAt: string;
}

export interface AdminSegmentationsResponse {
  segmentations: AdminSegmentation[];
  total: number;
  summary: {
    total: number;
    byStatus: Record<SegmentationStatus, number>;
    pending: number;
    stuckCount: number;
    stuckTimeoutMinutes: number;
    failed: number;
    spentUsd: number;
    models: { model: string; count: number }[];
  };
}

export interface AdminSegmentationDetailResponse {
  segmentation: AdminSegmentation;
}

export type AdminAuditAction = "credits.adjust" | "user.update" | "settings.update";
export type AdminAuditRange = "today" | "7d" | "30d";

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
  summary: {
    total: number;
    last7Days: number;
    byAction: Record<AdminAuditAction, number>;
    uniqueActors: number;
    lastSettingsAt: string | null;
    actors: { id: string; email: string; count: number }[];
  };
}
