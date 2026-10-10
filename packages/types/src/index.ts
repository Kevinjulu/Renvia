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
   * result can't be reproduced (currently true for the production reference-edit route).
   */
  seed: number | null;
  /** Starred by the owner in the results panel. */
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
}

/** "auto" matches the source image; the rest ask the model for a fixed output shape. */
export type AspectRatio = "auto" | "1:1" | "16:9" | "4:3" | "3:4" | "9:16";

/** mock = free placeholder results; dev = cheapest real model; prod = production model. */
export type RenderEngineMode = "mock" | "dev" | "prod";

/** drawing = CAD/line elevation (geometry-locked model); photo = photo or 3D massing. */
export type RenderSourceType = "drawing" | "photo";
export type FidelityMode = "standard" | "strict";

/** Source-design features a strict reference render must not redesign. */
export type ProtectedGeometryFeature =
  | "silhouette"
  | "roof"
  | "openings"
  | "massing"
  | "camera";

/**
 * A user-reviewed source-design contract. This is intentionally stored with the render so
 * a result can always be traced back to the geometry rules in force when it was made.
 */
export interface FidelitySettings {
  mode: FidelityMode;
  protectedFeatures: ProtectedGeometryFeature[];
  reviewedAt?: string;
}

export interface PromptRepairResponse {
  /** Safe, concise direction suitable for a source-locked reference render. */
  prompt: string;
  /** Plain-language changes made by the deterministic repairer. */
  repairs: string[];
  /** Structural requests deliberately left out of a source-locked prompt. */
  blocked: string[];
}

export type EditMode = "element" | "building" | "prompt";
export type EditAction = "add" | "remove" | "change";
export type UpscaleTarget = "4k" | "8k";

/**
 * How the person asked for the edit, picked explicitly in the Edit tab. Older edit jobs
 * predate it and only carry `mode`; see editMethodFor.
 */
export type EditMethod = "prompt" | "reference" | "reference-prompt";

// Option lists are shared so the Studio's controls and the API's validation can't drift.
export const EDIT_TIMES_OF_DAY = ["morning", "midday", "golden-hour", "dusk", "night"] as const;
export const EDIT_SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export const EDIT_WEATHER = ["clear", "overcast", "rain", "snow", "fog"] as const;
export const FACADE_MATERIALS = ["brick", "stone", "stucco", "timber", "concrete", "metal", "glass"] as const;
/** Architectural looks: they restyle finishes and details, never the building's form. */
export const EDIT_STYLES = ["modern", "minimalist", "scandinavian", "mediterranean", "farmhouse", "industrial", "tropical", "classic"] as const;

export type EditTimeOfDay = (typeof EDIT_TIMES_OF_DAY)[number];
export type EditSeason = (typeof EDIT_SEASONS)[number];
export type EditWeather = (typeof EDIT_WEATHER)[number];
export type FacadeMaterial = (typeof FACADE_MATERIALS)[number];
export type EditStyle = (typeof EDIT_STYLES)[number];

/** Longest facade colour (a name or hex value) the API accepts. */
export const MAX_FACADE_COLOR_CHARS = 40;
/** Edits take a single reference: more than one leaves the model guessing which to follow. */
export const MAX_EDIT_REFERENCES = 1;

/**
 * Scene-wide changes applied over the whole result, never limited to a selected area.
 * Every field is optional; an unset field means "leave it as it is".
 */
export interface EditEnvironment {
  timeOfDay?: EditTimeOfDay;
  season?: EditSeason;
  weather?: EditWeather;
  style?: EditStyle;
  /** A colour name or hex value, e.g. "warm white" or "#e8e2d4". */
  facadeColor?: string;
  facadeMaterial?: FacadeMaterial;
}

/** Present on edit jobs (Edit tab); absent on renders. */
export interface RenderEditSettings {
  mode: EditMode;
  method?: EditMethod;
  action?: EditAction;
  /**
   * White-on-black PNG at the source image's size; white marks the area to edit.
   * Only that area of the model's output is pasted back onto the source.
   */
  maskImageUrl?: string;
  environment?: EditEnvironment;
  /**
   * Set by the API, never the client: the selection's composited result, stored when the first
   * of a two-pass edit finishes. Its presence means the environment pass has taken over.
   */
  intermediateImageUrl?: string;
}

/** True when the environment asks for at least one change. */
export function hasEnvironmentChange(environment: EditEnvironment | undefined): boolean {
  if (!environment) return false;
  return Object.values(environment).some((value) => typeof value === "string" && value.trim() !== "");
}

/** The edit's method, deriving one for older jobs that only recorded `mode`. */
export function editMethodFor(edit: RenderEditSettings, { hasReferences, hasPrompt }: { hasReferences: boolean; hasPrompt: boolean }): EditMethod {
  if (edit.method) return edit.method;
  if (!hasReferences) return "prompt";
  return hasPrompt ? "reference-prompt" : "reference";
}

/**
 * Model passes an edit takes. A selection edit composites only the selected area back, so an
 * environment change on top of it needs a second pass over the whole result; everything else
 * is a single pass.
 */
export function editPassCount(edit: RenderEditSettings): number {
  return edit.maskImageUrl && hasEnvironmentChange(edit.environment) ? 2 : 1;
}

/**
 * Why an edit request can't run, or null when it can. Shared so the Studio explains the same
 * thing the API would refuse.
 */
export function editRequestProblem({
  edit,
  prompt,
  referenceCount,
}: {
  edit: RenderEditSettings;
  prompt: string;
  referenceCount: number;
}): string | null {
  const hasPrompt = prompt.trim() !== "";
  const hasReferences = referenceCount > 0;
  const hasEnvironment = hasEnvironmentChange(edit.environment);
  if (referenceCount > MAX_EDIT_REFERENCES) return "Edits use one reference image.";
  // The environment is applied over the whole result, so a selection with nothing else to do
  // inside it would be an empty first pass.
  if (edit.maskImageUrl && !hasPrompt && !hasReferences) {
    return "Describe the change for the selected area, or clear the selection to change only the environment.";
  }
  switch (edit.method) {
    case "prompt":
      return hasPrompt || hasEnvironment ? null : "Describe the change or pick an environment change.";
    case "reference":
      return hasReferences ? null : "Add a reference image.";
    case "reference-prompt":
      if (!hasReferences) return "Add a reference image.";
      return hasPrompt ? null : "Describe what to take from the reference.";
    default:
      return hasPrompt || hasReferences || hasEnvironment ? null : "Describe an edit, attach a reference or pick an environment change.";
  }
}

/** Present on high-resolution export jobs, which preserve an existing render rather than generating a new design. */
export interface RenderUpscaleSettings {
  target: UpscaleTarget;
  parentRenderId: string;
}

/** Which model family serves a job. */
export type RenderRoute = RenderSourceType | "references" | "fidelity" | "edit" | "edit-references" | "upscale";

/**
 * A short prompt can clearly describe one local change even when it was typed into the
 * full-render field. Keep this shared between Studio's safe handoff and the API guard so an
 * older client cannot spend a credit on a whole-building re-render by accident.
 */
export function suggestedEditPartForPrompt(prompt: string):
  | "windows"
  | "doors"
  | "roof"
  | "walls"
  | "balconies"
  | "columns"
  | "garage"
  | "fence"
  | "landscaping"
  | "sky"
  | null {
  const normalized = prompt.toLowerCase();
  if (/\b(whole|entire|all)\s+(house|building|facade|façade|image)\b/.test(normalized)) return null;
  if (!/\b(change|make|turn|paint|recolor|recolour|replace|update)\b/.test(normalized)) return null;
  if (/\b(window|windows|window\s*frames?|frames?)\b/.test(normalized)) return "windows";
  if (/\bdoors?\b/.test(normalized)) return "doors";
  if (/\b(roof|roofline|tiles?)\b/.test(normalized)) return "roof";
  if (/\b(walls?|facade|façade|cladding)\b/.test(normalized)) return "walls";
  if (/\b(balcony|balconies|railings?)\b/.test(normalized)) return "balconies";
  if (/\b(columns?|pillars?)\b/.test(normalized)) return "columns";
  if (/\b(garage|garage door)\b/.test(normalized)) return "garage";
  if (/\b(fence|gate)\b/.test(normalized)) return "fence";
  if (/\b(landscap|plants?|trees?|grass|paving)\b/.test(normalized)) return "landscaping";
  if (/\bsky\b/.test(normalized)) return "sky";
  return null;
}

export function renderRouteFor(settings: RenderGenerationSettings): RenderRoute {
  if (settings.upscale) return "upscale";
  const hasReferences = (settings.referenceImageUrls?.length ?? 0) > 0;
  if (settings.edit) return hasReferences ? "edit-references" : "edit";
  if (hasReferences && settings.fidelity?.mode === "strict") return "fidelity";
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
  /** Strict mode records the user's source-design contract and hardens reference prompts. */
  fidelity?: FidelitySettings;
  referenceImageUrls?: string[];
  edit?: RenderEditSettings;
  upscale?: RenderUpscaleSettings;
  /** Reuse a previous render's seed to reproduce it, or nudge it with a new prompt/strength. */
  seed?: number;
}

/**
 * Customer-visible base credit price for a render action. The operator's
 * `creditsPerImage` setting multiplies image-generation routes, while upscales carry
 * their own explicit cost. Keep this shared so the Studio quote and API debit agree.
 */
export function baseCreditCostForRender(settings: RenderGenerationSettings): number {
  if (settings.upscale) return settings.upscale.target === "8k" ? 2 : 1;
  if (settings.edit) return editPassCount(settings.edit);
  const hasReferences = (settings.referenceImageUrls?.length ?? 0) > 0;
  if (hasReferences && settings.fidelity?.mode === "strict") return 2;
  return 1;
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

export interface CreateUpscaleRequest {
  target: UpscaleTarget;
}

export interface CreateUpscaleResponse {
  job: RenderJob;
}

export interface UpdateRenderRequest {
  isFavorite: boolean;
}

export interface UpdateRenderResponse {
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

/**
 * Roles are deliberately capability-oriented rather than a single all-powerful
 * operator bucket. `admin` remains the break-glass role; the other staff roles
 * are restricted by the API as well as by the admin UI.
 */
export type UserRole = "user" | "analyst" | "support" | "billing" | "admin";

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
  | "purchase"
  | "purchase_refund"
  | "subscription_grant"
  | "subscription_expiry";

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
  | "concurrency_limit_reached"
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
  concurrentRenders: number | null;
  maxProjects: number | null;
  maxCreditBalance: number | null;
  maxUploadMb: number;
  maxReferenceImages: number;
  maxPromptChars: number;
  maxSelectionPromptChars: number;
  lowCreditThreshold: number;
  /** True when the user skips daily/monthly caps and maintenance pauses (admins and exempt users). */
  exempt: boolean;
  /** Which of the daily/monthly caps came from a per-user override rather than the plan setting. */
  overridden: { dailyRenders: boolean; dailySegments: boolean; monthlyRenders: boolean; monthlySegments: boolean };
}

/** Consumption against `UserLimits`, counted in UTC and excluding failed (refunded) work. */
export interface UserUsage {
  rendersToday: number;
  segmentsToday: number;
  rendersThisMonth: number;
  rendersInFlight: number;
  segmentsThisMonth: number;
  projects: number;
}

export interface MeResponse {
  id: string;
  clerkId: string;
  email: string;
  role: UserRole;
  /** Spendable credits; standard renders cost 1 and premium routes can cost more. Admins aren't charged. */
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
  /** The separate commercial entitlement governing those limits. */
  entitlement: BillingEntitlement;
  /** What they've used against those limits today and this month. */
  usage: UserUsage;
  /** Operator-authored refusal copy; a null entry means use the studio's built-in wording. */
  limitMessages: Partial<Record<LimitCode, string | null>>;
  createdAt: string;
  updatedAt: string;
}

export type BillingProvider = "paypal" | "stripe" | "paystack" | "flutterwave" | "mpesa";
export type BillingEntitlementStatus = "active" | "past_due" | "canceled" | "expired";

/** Public plan definition. Limits and entitlement—not credit balance—govern account access. */
export interface BillingPlan {
  id: string;
  slug: "starter" | "studio" | "team" | string;
  name: string;
  description: string;
  currency: string;
  priceCents: number;
  interval: "none" | "month";
  monthlyCredits: number;
  /** Included subscription credits that may survive renewal; currently 0 on every plan. */
  rolloverCredits: number;
  dailyRenderLimit: number | null;
  monthlyRenderLimit: number | null;
  maxProjects: number | null;
  concurrentRenderLimit: number | null;
}

export interface BillingEntitlement {
  plan: BillingPlan;
  status: BillingEntitlementStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  monthlyCreditsRemaining: number;
}

/** A server-priced, one-off credit product. The browser never supplies price or credits. */
export interface CreditPack {
  sku: string;
  name: string;
  currency: string;
  priceCents: number;
  credits: number;
}

export interface BillingCheckout {
  id: string;
  kind: "credit_pack" | "subscription";
  provider: BillingProvider;
  status: "created" | "pending" | "paid" | "expired" | "canceled" | "failed";
  currency: string;
  amountCents: number;
  creditPackSku: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Customer-facing billing state. `paypalCheckoutAvailable` is false until all server credentials are configured. */
export interface BillingCatalogResponse {
  creditPacks: CreditPack[];
  recentCheckouts: BillingCheckout[];
  paypalCheckoutAvailable: boolean;
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
  /** Last authenticated Studio, website, or API activity. */
  lastActiveAt: string | null;
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

export type AdminUserSort = "createdAt" | "lastActiveAt" | "lastRenderAt" | "creditBalance" | "renderCount" | "spentUsd";
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
  notes: { id: string; body: string; authorEmail: string; createdAt: string }[];
  tags: { id: string; label: string; createdAt: string }[];
  projects: { id: string; name: string; createdAt: string; updatedAt: string }[];
  payments: { id: string; provider: string; status: string; amountCents: number; currency: string; createdAt: string; paidAt: string | null }[];
  entitlement: { status: string; currentPeriodEnd: string | null; planName: string | null; planSlug: string | null } | null;
  recentErrors: { id: string; errorMessage: string | null; createdAt: string; projectName: string }[];
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
  /** Required for security-sensitive role and account-state changes. */
  reason?: string;
}

export interface AdminOverviewResponse {
  users: { total: number; newLast7Days: number; activeNow: number; activeLastHour: number; activeLast24Hours: number; activeLast7Days: number; disabled: number };
  /** Authenticated customer activity only—anonymous public visitors are not attributable to a user. */
  activity: { measuredAt: string; activeNow: { id: string; email: string; lastActiveAt: string }[] };
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
  credits: { outstanding: number; granted: number; spent: number; grantedLast7Days: number; spentLast7Days: number };
  /** Live, internally tracked fal spend against the configured API-token budget. */
  tokenUsage: {
    provider: "fal";
    configured: boolean;
    budgetUsd: number;
    spentUsd: number;
    remainingUsd: number;
    usedPercent: number | null;
    measuredAt: string;
  };
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

export type AdminAuditAction =
  | "credits.adjust"
  | "user.update"
  | "settings.update"
  | "render.refresh"
  | "render.cancel"
  | "segmentation.recover"
  | "incident.update"
  | "billing.webhook"
  | "billing.payment"
  | "billing.entitlement"
  | "customer.note"
  | "customer.tag"
  | "user.session_revoke"
  | "approval.request"
  | "approval.approve"
  | "approval.reject"
  | "approval.execute"
  | "audit.export";
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

/** Billing operations view. Provider event bodies never leave the API. */
export interface AdminBillingResponse {
  summary: { paidUsd: number; refundedUsd: number; pendingWebhooks: number; failedWebhooks: number };
  plans: { id: string; name: string; slug: string; priceCents: number; currency: string; active: boolean; subscribers: number }[];
  payments: { id: string; userId: string; userEmail: string; provider: string; providerPaymentId: string; status: string; amountCents: number; currency: string; createdAt: string; paidAt: string | null }[];
  webhooks: { id: string; provider: string; eventType: string; status: "processed" | "failed" | "pending"; attempts: number; failureMessage: string | null; createdAt: string }[];
}

/** Revenue is confirmed provider capture data; FAL cost is an internal estimate, never a wallet balance. */
export interface AdminFinancialsResponse {
  revenue: { capturedUsd: number; refundedUsd: number; netUsd: number; mrrUsd: number; failedPayments: number; conversionRate: number; churnedSubscribers: number };
  estimatedCost: { falUsd: number; dailyBurnUsd: number; projectedBudgetExhaustion: string | null; trackedBudgetUsd: number | null; reconciliationStatus: "not_connected" };
  margins: { byPlan: { label: string; revenueUsd: number; estimatedCostUsd: number; marginUsd: number }[]; byPack: { label: string; revenueUsd: number; estimatedCostUsd: number; marginUsd: number }[]; byModel: { label: string; estimatedCostUsd: number; renders: number }[]; byCustomer: { userId: string; email: string; revenueUsd: number; estimatedCostUsd: number; marginUsd: number }[] };
  daily: { day: string; revenueUsd: number; estimatedCostUsd: number; refundsUsd: number; failedPayments: number }[];
}

export interface AdminOperationsQueueResponse {
  assignedIncidents: { id: string; title: string; severity: IncidentSeverity; status: IncidentStatus; updatedAt: string }[];
  pendingApprovals: { id: string; action: string; reason: string; requestedBy: string; createdAt: string }[];
  failedJobs: { id: string; type: "render" | "segmentation"; label: string; userId: string; createdAt: string }[];
}

export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus = "open" | "acknowledged" | "resolved";
export type IncidentSourceType = "render" | "segmentation" | "webhook" | "system";
export type IncidentEventAction = "opened" | "assigned" | "acknowledged" | "recovered" | "resolved" | "reopened" | "notification";

export interface AdminIncident {
  id: string;
  sourceType: IncidentSourceType;
  sourceId: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  summary: string;
  context: Record<string, unknown> | null;
  ownerId: string | null;
  ownerEmail: string | null;
  acknowledgement: { at: string; byEmail: string | null } | null;
  resolution: { at: string; byEmail: string | null; note: string | null } | null;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  events: { id: string; action: IncidentEventAction; note: string | null; actorEmail: string | null; createdAt: string }[];
  notifications: { id: string; status: "delivered" | "failed" | "skipped"; destination: string | null; failureMessage: string | null; attemptedAt: string; deliveredAt: string | null }[];
}

export interface AdminIncidentsResponse {
  incidents: AdminIncident[];
  staff: { id: string; email: string; role: UserRole }[];
  summary: Record<IncidentStatus, number> & { criticalOpen: number; failedNotifications: number };
}
