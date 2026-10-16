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
/**
 * Most references one edit takes. Each is tagged with the part it is for (see
 * EditReferenceTarget), so the model is told which image dresses which part rather than
 * left guessing between them. The model itself takes ten images; one is the render.
 */
export const MAX_EDIT_REFERENCES = 5;

/**
 * What an edit reference is for: the whole look, or one part of the building it should dress
 * ("a roof tile sample" → the roof). "other" carries its own words in EditReference.note.
 */
export const EDIT_REFERENCE_TARGETS = ["look", "roof", "walls", "windows", "doors", "paving", "columns", "railings", "garden", "other"] as const;
export type EditReferenceTarget = (typeof EDIT_REFERENCE_TARGETS)[number];
/** Longest note the person may add to a reference ("the grey stone, not the brick"). */
export const MAX_EDIT_REFERENCE_NOTE_CHARS = 80;

/** One edit reference's tag, in the same order as referenceImageUrls. */
export interface EditReference {
  target: EditReferenceTarget;
  /** The person's own words about it; required for "other", optional otherwise. */
  note?: string;
}

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
/** One separate area of an edit's selection. */
export interface EditSelectionArea {
  /** Bounding box in the source image's pixels. */
  box: { left: number; top: number; width: number; height: number };
  /** What it is ("front door"), from Auto select's words or a quick pick. */
  label?: string;
}

export interface RenderEditSettings {
  mode: EditMode;
  method?: EditMethod;
  action?: EditAction;
  /**
   * White-on-black PNG at the source image's size; white marks the area to edit.
   * Only that area of the model's output is pasted back onto the source.
   */
  maskImageUrl?: string;
  /**
   * What the selection is, in the person's words ("front door"). Written by Studio before
   * selections had separate areas; kept so those jobs still read. New edits send selectionAreas.
   */
  selectionLabel?: string;
  /**
   * The selection's separate areas, largest first, each with its box in source pixels and the
   * person's tag for it if they gave one. Tells the model what and where each area is.
   */
  selectionAreas?: EditSelectionArea[];
  /**
   * What each reference is for, index for index with referenceImageUrls. Edits from before
   * references were tagged have none; each untagged reference counts as "look".
   */
  references?: EditReference[];
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
  if (referenceCount > MAX_EDIT_REFERENCES) return `Edits take up to ${MAX_EDIT_REFERENCES} reference images.`;
  if ((edit.references ?? []).some((reference) => reference.target === "other" && !reference.note?.trim())) {
    return "Say what each reference marked “Other” is for.";
  }
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

/**
 * An output resolution chosen before rendering. The render runs as usual, then an AI upscale
 * pass makes a 4K or 8K copy for downloads, all inside the same job. The standard-size result
 * stays the render's resultImageUrl, so the Studio, edits and "set as base" keep using it.
 */
export interface RenderHighResSettings {
  target: UpscaleTarget;
  /** Set by the API once the render pass finishes: the standard result, upscaled next. */
  baseImageUrl?: string;
  /** Set by the API when the upscale pass succeeds: the high-resolution file. */
  imageUrl?: string;
  /** Why the upscale pass failed; its credits were refunded and the standard result kept. */
  error?: string;
}

/** Credits an upscale to `target` adds, before the operator's creditsPerImage multiplier. */
export function upscaleCreditCost(target: UpscaleTarget): number {
  return target === "8k" ? 2 : 1;
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
  /** Render tab only: also deliver a 4K or 8K copy of the result (see RenderHighResSettings). */
  highRes?: RenderHighResSettings;
  /** Reuse a previous render's seed to reproduce it, or nudge it with a new prompt/strength. */
  seed?: number;
}

/**
 * Customer-visible base credit price for a render action. The operator's
 * `creditsPerImage` setting multiplies image-generation routes, while upscales carry
 * their own explicit cost. Keep this shared so the Studio quote and API debit agree.
 */
export function baseCreditCostForRender(settings: RenderGenerationSettings): number {
  if (settings.upscale) return upscaleCreditCost(settings.upscale.target);
  if (settings.edit) return editPassCount(settings.edit);
  const hasReferences = (settings.referenceImageUrls?.length ?? 0) > 0;
  const render = hasReferences && settings.fidelity?.mode === "strict" ? 2 : 1;
  return render + (settings.highRes ? upscaleCreditCost(settings.highRes.target) : 0);
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
  /**
   * One per Generate/Apply click, reused when that same request is retried. A repeat returns
   * the render the first attempt created instead of charging again.
   */
  idempotencyKey?: string;
  /** Beta testers only: "account" spends their own credits, by their explicit choice. Omitted = beta credits. */
  funding?: BetaFunding;
}

export interface CreateRenderResponse {
  job: RenderJob;
  /** True when this key had already created the render, so nothing new was queued or charged. */
  replayed?: boolean;
}

export interface CreateUpscaleRequest {
  target: UpscaleTarget;
  /** One per export click, reused on retry — see CreateRenderRequest.idempotencyKey. */
  idempotencyKey?: string;
  /** Beta testers only: "account" spends their own credits, by their explicit choice. Omitted = beta credits. */
  funding?: BetaFunding;
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
  | "subscription_expiry"
  /** The plan's monthly allowance, at the start of a credit period or as an upgrade top-up. */
  | "plan_grant"
  /** Unspent monthly plan credits removed when the next period starts. */
  | "plan_expiry"
  /** Unspent signup or starting credits replaced by the first monthly allowance. */
  | "promo_expiry"
  /** Beta credits granted by a beta program, on enrollment or as a top-up. */
  | "beta_grant"
  /** Unspent beta credits removed when the tester's enrollment ended. */
  | "beta_expiry";

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
  /** Beta testers only: "account" spends their own credits, by their explicit choice. Omitted = beta credits. */
  funding?: BetaFunding;
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
  | "upload_too_large"
  /** An operator switched this Studio feature off, or it isn't available on the user's plan. */
  | "feature_disabled"
  /** Stored images reached the operator's storage cap; nothing new can be saved. */
  | "storage_full"
  /** A beta-funded job needs more beta credits than the tester has left. */
  | "beta_credits_exhausted"
  /** The beta program's shared provider budget can't cover this job. */
  | "beta_budget_exhausted"
  /** Beta funding was asked for, but the caller has no running enrollment (paused, suspended, ended or none). */
  | "beta_unavailable";

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
  /** Each Studio feature and whether this user may use it right now. */
  features: Record<StudioFeatureKey, StudioFeatureAvailability>;
  /** What each action costs this user now; use these rather than creditsPerImage. */
  creditPrices: CreditPrices;
  /** The published Studio configuration version these answers come from. */
  configVersion: number;
  /** The next scheduled maintenance window, while it is upcoming or running. */
  upcomingMaintenance: { scope: MaintenanceScope; startsAt: string; endsAt: string; message: string | null } | null;
  /** What this user may do right now. */
  limits: UserLimits;
  /** The separate commercial entitlement governing those limits. */
  entitlement: BillingEntitlement;
  /** What they've used against those limits today and this month. */
  usage: UserUsage;
  /** Operator-authored refusal copy; a null entry means use the studio's built-in wording. */
  limitMessages: Partial<Record<LimitCode, string | null>>;
  /** The part of creditBalance granted by a beta program; only beta-funded jobs spend it. */
  betaCredits: number;
  /** The caller's live beta enrollment; null when they aren't a tester. */
  beta: MeBeta | null;
  createdAt: string;
  updatedAt: string;
}

/** A tester's program as /me reports it. */
export interface MeBeta {
  programId: string;
  programName: string;
  /** The enrollment's status: active or suspended (ended enrollments aren't reported). */
  status: "active" | "suspended";
  /** True when beta-funded jobs are accepted now: enrollment and program active, inside the dates. */
  running: boolean;
  /** When this tester's access ends, including any per-tester extension. */
  endsAt: string;
  downloadsUnlocked: boolean;
  featureGrants: StudioFeatureKey[];
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
  /** Price of a year paid up front; null when the plan isn't sold yearly. */
  yearlyPriceCents: number | null;
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
  /** How the paid subscription is billed; null on the Free plan. */
  billingInterval: BillingInterval | null;
  /** Who bills the subscription; null or "manual" when nobody does. */
  provider: BillingProvider | "manual" | null;
  /** True when the provider will charge again at period end without the customer acting. */
  autoRenews: boolean;
  /** Unspent monthly plan credits; they are part of creditBalance and are spent first. */
  monthlyCreditsRemaining: number;
  /** Credits the current plan grants each period. */
  monthlyAllowance: number;
  /** When unspent plan credits expire and the allowance is granted again; null if not scheduled. */
  nextCreditRenewalAt: string | null;
  /** Set while an admin-granted plan applies; `plan` is that plan. endsAt null = until removed. */
  complimentary: { endsAt: string | null } | null;
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
  /** For a subscription checkout: the plan and period it pays for. */
  planName: string | null;
  billingInterval: BillingInterval | null;
  createdAt: string;
  updatedAt: string;
}

export type BillingInterval = "month" | "year";

/** How a customer pays: PayPal, or card / M-Pesa through Paystack. */
export type PaymentMethod = "paypal" | "card" | "mpesa";

/** A plan as offered on the billing page. Server-priced; the browser never supplies a price. */
export interface BillingPlanOffer {
  slug: string;
  name: string;
  description: string;
  currency: string;
  priceCents: number;
  yearlyPriceCents: number | null;
  monthlyCredits: number;
  dailyRenderLimit: number | null;
  maxProjects: number | null;
  concurrentRenderLimit: number | null;
  /** The billing periods each payment method can sell right now; empty when it can't sell this plan. */
  payable: Record<PaymentMethod, BillingInterval[]>;
  /** Whether a card payment renews automatically (a Paystack plan code is set for that period). */
  cardAutoRenews: Record<BillingInterval, boolean>;
}

/** Customer-facing billing state. A payment method is false until its server credentials are configured. */
export interface BillingCatalogResponse {
  plans: BillingPlanOffer[];
  creditPacks: CreditPack[];
  recentCheckouts: BillingCheckout[];
  paypalCheckoutAvailable: boolean;
  paymentMethods: Record<PaymentMethod, boolean>;
  /** M-Pesa is charged in Kenyan shillings at this many KES per USD; null when M-Pesa is unavailable. */
  kesPerUsd: number | null;
  /** The currency card payments are charged in; null when cards are unavailable. */
  cardCurrency: "KES" | "USD" | null;
  /** Where the Enterprise "Contact us" goes; null uses the website's contact page. */
  salesContactEmail: string | null;
}

export interface CreateCheckoutRequest {
  kind: "credit_pack" | "subscription";
  /** Credit pack SKU or plan slug. */
  product: string;
  /** Required for a subscription. */
  interval?: BillingInterval;
  method: PaymentMethod;
  idempotencyKey: string;
}

export interface CreateCheckoutResponse {
  checkoutId: string;
  status: BillingCheckout["status"];
  /** Where to send the browser to pay. */
  approvalUrl: string | null;
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

/** Sample-image categories in the Studio reference library, in display order. */
export const REFERENCE_CATEGORIES = [
  { key: "windows", label: "Windows" },
  { key: "roof", label: "Roof" },
  { key: "doors", label: "Doors" },
  { key: "pillars", label: "Pillars" },
  { key: "outdoors", label: "Outdoors" },
  { key: "exterior", label: "Exterior" },
] as const;

export type ReferenceCategory = (typeof REFERENCE_CATEGORIES)[number]["key"];

/** A sample reference the team uploaded for every user. */
export interface StockReference {
  id: string;
  category: ReferenceCategory;
  url: string;
  caption: string | null;
}

/** Visible samples only, in each category's display order. */
export interface ListStockReferencesResponse {
  references: StockReference[];
}

export interface AdminStockReference extends StockReference {
  hidden: boolean;
  sortOrder: number;
  bytes: number;
  createdAt: string;
}

export interface AdminStockReferencesResponse {
  references: AdminStockReference[];
  /** Bytes stored under stock/, for the storage line on the page. */
  totalBytes: number;
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
  entitlement: AdminUserEntitlement | null;
  /** Active plans an admin can assign. */
  plans: AdminPlanOption[];
  recentErrors: { id: string; errorMessage: string | null; createdAt: string; projectName: string }[];
}

export interface AdminPlanOption {
  id: string;
  slug: string;
  name: string;
  priceCents: number;
  monthlyCredits: number;
}

export interface AdminUserEntitlement {
  status: string;
  currentPeriodEnd: string | null;
  /** The plan in effect now: the admin-granted plan while it applies, otherwise the base plan. */
  planName: string;
  planSlug: string;
  /** The plan held in the user's own right; an override never changes it. */
  basePlanName: string;
  basePlanSlug: string;
  provider: string | null;
  /** Unspent monthly plan credits (part of the balance) and what the plan grants each period. */
  planCredits: number;
  monthlyAllowance: number;
  /** When plan credits next expire and the allowance is granted; null until the first period starts. */
  nextCreditRenewalAt: string | null;
  /** The most recent admin-granted plan. `active` is false once its end date has passed. */
  override: {
    planId: string;
    planName: string;
    planSlug: string;
    endsAt: string | null;
    reason: string | null;
    setByEmail: string | null;
    setAt: string | null;
    active: boolean;
  } | null;
}

/** Grants a plan without payment. It sits on top of the user's base plan until endsAt. */
export interface AdminSetPlanRequest {
  planId: string;
  /** ISO date-time in the future; null keeps it until an admin removes it. */
  endsAt: string | null;
  reason: string;
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
  /** The real fal wallet from fal's Platform API (FAL_ADMIN_KEY), to compare with our estimates. */
  falAccount:
    | { status: "unconfigured" }
    | { status: "error"; message: string }
    | { status: "ok"; balanceUsd: number | null; currency: string; spentLast30DaysUsd: number; measuredAt: string };
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
    id: "budget_warning" | "budget_critical" | "failure_rate" | "stuck_renders" | "engine_mode" | "maintenance" | "storage_warning" | "storage_critical" | "fal_balance_low";
    severity: "warning" | "critical" | "info";
    message: string;
    href: string;
  }[];
}

export interface AdminPlanCredits {
  slug: string;
  name: string;
  /** Plan credits granted at the start of each monthly credit period. */
  monthlyCredits: number;
}

export interface AdminSettings {
  /** Each active plan's monthly allowance. A change applies from each user's next period. */
  planMonthlyCredits: AdminPlanCredits[];
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
  /** True once Plans & Pricing published credit prices: creditsPerImage/Selection then don't apply. */
  creditPricesPublished: boolean;
  /** New uploads and renders are refused once stored images reach this (MB of 10^6 bytes). */
  storageCapMb: number;
  /** Stored images, from the storage ledger. */
  storage: { usedBytes: number; capBytes: number; objects: number; byKind: { upload: number; render: number; watermark: number; feedback: number; stock: number } };
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
  /**
   * Set on a save whose maintenance switches are waiting for a second admin (answered 202).
   * Every other field in that save has already been applied.
   */
  pendingApproval?: { approvalId: string; fields: string[] };
}

export type AdminUpdateSettingsRequest = Partial<
  Pick<
    AdminSettings,
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
    | "storageCapMb"
    | "falMode"
    | "falBudgetUsd"
  > & {
    /** Plan slug to monthly credits; plans left out are unchanged. */
    planMonthlyCredits: Record<string, number>;
    /** Kept in the audit row; the approval reason when a maintenance switch needs approval. */
    reason: string;
  }
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
  | "audit.export"
  | "studio.publish"
  | "maintenance.window"
  | "plan.update"
  /** Beta program changes: programs, invitations, enrollments, grants and budgets (see targetType). */
  | "beta.update"
  /** Sample reference images: uploads, captions, hiding, ordering and deletes. */
  | "library.update";
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
  /** Payment figures cover the last 30 days; conversionRate is paid checkouts over checkouts started in that window. */
  revenue: { capturedUsd: number; refundedUsd: number; netUsd: number; mrrUsd: number; failedPayments: number; conversionRate: number; churnedSubscribers: number };
  estimatedCost: { falUsd: number; dailyBurnUsd: number; projectedBudgetExhaustion: string | null; trackedBudgetUsd: number | null; reconciliationStatus: "not_connected" };
  /** Last 30 days. byPlan and byPack carry revenue only: credit spend can't be traced back to the purchase that paid for it. */
  margins: { byPlan: { label: string; revenueUsd: number }[]; byPack: { label: string; revenueUsd: number }[]; byModel: { label: string; estimatedCostUsd: number; renders: number }[]; byCustomer: { userId: string; email: string; revenueUsd: number; estimatedCostUsd: number; marginUsd: number }[] };
  daily: { day: string; revenueUsd: number; estimatedCostUsd: number; refundsUsd: number; failedPayments: number }[];
}

export type ApprovalAction = "bulk_credits" | "refund" | "role_change" | "maintenance" | "studio_change" | "maintenance_window" | "plan_change" | "beta_grant" | "beta_budget";

/** When each high-risk action needs a second admin. 0 turns that gate off. */
export interface AdminGovernanceThresholds {
  /** Credits per user times users at or above which a bulk grant needs approval. */
  bulkCreditApprovalThreshold: number;
  /** Refund amount, in the payment currency's minor unit, at or above which it needs approval. */
  refundApprovalThresholdCents: number;
  /** 1 holds every role change for approval. */
  roleChangeApprovalThreshold: number;
  /** 1 holds every maintenance pause or resume, and every scheduled window, for approval. */
  maintenanceApprovalThreshold: number;
  /** 1 holds every Studio Control publish (feature rules) for approval. */
  studioChangeApprovalThreshold: number;
}

export interface AdminGovernanceResponse {
  settings: AdminGovernanceThresholds & { updatedAt: string; updatedBy: string | null };
  pending: { id: string; action: ApprovalAction; reason: string; riskValue: number; threshold: number; createdAt: string; requestedBy: string }[];
}

export type AdminUpdateGovernanceRequest = AdminGovernanceThresholds & { reason: string };

/** A refund either completes now or, at or above the refund threshold, waits for approval (202). */
export type AdminRefundResponse = { id: string; status: "refunded" } | { pendingApproval: true; approvalId: string };

export interface AdminAuditExportResponse {
  id: string;
  sha256: string;
  rows: number;
}
export type ApprovalStatus = "pending" | "approved" | "rejected" | "executed" | "cancelled";

/** A high-risk action held for a second administrator. The can* flags are this viewer's options. */
export interface AdminApproval {
  id: string;
  action: ApprovalAction;
  status: ApprovalStatus;
  /** What executing it does, in plain language. */
  summary: string;
  reason: string;
  riskValue: number;
  threshold: number;
  requestedByEmail: string | null;
  decidedByEmail: string | null;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
  executedAt: string | null;
  canApprove: boolean;
  canReject: boolean;
  canExecute: boolean;
}

export interface AdminApprovalsResponse {
  /** Pending a decision, or approved and waiting to be executed. */
  open: AdminApproval[];
  /** The 20 most recently created requests that are rejected, executed or cancelled. */
  recent: AdminApproval[];
}

export interface AdminOperationsQueueResponse {
  assignedIncidents: { id: string; title: string; severity: IncidentSeverity; status: IncidentStatus; updatedAt: string }[];
  pendingApprovals: { id: string; action: string; reason: string; requestedBy: string; createdAt: string }[];
  failedJobs: { id: string; type: "render" | "segmentation"; label: string; userId: string; createdAt: string }[];
}

export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus = "open" | "acknowledged" | "resolved";
export type IncidentSourceType = "render" | "segmentation" | "webhook" | "system";
export type IncidentEventAction = "opened" | "assigned" | "acknowledged" | "recovered" | "resolved" | "reopened" | "severity_changed" | "notification";

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
  /** The scheduled operations sync that opens these incidents. Times are ISO; null = never. */
  sync: { lastStartedAt: string | null; lastSuccessAt: string | null; lastFailureAt: string | null; lastError: string | null; running: boolean };
}

// ── Performance ───────────────────────────────────────────────────────────────────

export type AdminPerformanceRange = "24h" | "7d" | "30d";

/** Percentiles in milliseconds over `samples` jobs; null when there are no samples. */
export interface AdminLatencyStats {
  samples: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  /** Fewer than 20 samples: the percentiles say little. */
  weak: boolean;
}

export interface AdminPerformanceCounts {
  total: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  inFlight: number;
  /** Succeeded ÷ (succeeded + failed); cancelled jobs are left out. Null with nothing finished. */
  successRate: number | null;
  /** Succeeded jobs whose high-resolution upscale failed (they kept the standard result). */
  upscaleFailed: number;
}

export interface AdminPerformanceCosts {
  /** Estimated fal cost of the generation passes. */
  generationUsd: number;
  /** Estimated fal cost of 4K/8K upscale passes and standalone upscales. */
  upscaleUsd: number;
  /** All estimated cost ÷ succeeded jobs. */
  costPerSuccessUsd: number | null;
  creditsCharged: number;
}

export interface AdminPerformanceTimings {
  /** Created to completed, from lifecycle events. */
  endToEnd: AdminLatencyStats;
  /** Created to last update, an estimate for succeeded jobs without a completion event (older renders). */
  estimatedEndToEnd: AdminLatencyStats;
  /** Created to handed to the provider. */
  submission: AdminLatencyStats;
  /** Provider time for the first pass: submitted to its result. */
  provider: AdminLatencyStats;
  /** Upscale pass: started to the high-resolution copy stored. */
  upscale: AdminLatencyStats;
}

export interface AdminPerformanceRow extends AdminPerformanceCounts, AdminPerformanceCosts, AdminPerformanceTimings {
  jobType: string;
  /** The generation model (the first pass's), not the upscaler a high-res job ends on. */
  model: string;
  outputResolution: "4k" | "8k" | null;
}

export interface AdminPerformanceSummaryResponse {
  range: AdminPerformanceRange;
  generatedAt: string;
  totals: AdminPerformanceCounts & AdminPerformanceCosts & AdminPerformanceTimings;
  rows: AdminPerformanceRow[];
  segmentations: { total: number; succeeded: number; failed: number; pending: number; failureRate: number | null; costUsd: number };
  /** Renders in the range that have lifecycle events; the rest only have estimated timings. */
  coverage: { withEvents: number; total: number };
}

export interface AdminPerformanceTimeseriesResponse {
  range: AdminPerformanceRange;
  bucket: "hour" | "day";
  points: { start: string; total: number; succeeded: number; failed: number; costUsd: number; p50Ms: number | null; p95Ms: number | null; samples: number }[];
}

export type AdminFailureCategory =
  | "cancelled"
  | "timeout"
  | "submission"
  | "provider_output"
  | "content_policy"
  | "storage"
  | "invalid_input"
  | "provider"
  | "internal";

export interface AdminFailureGroup {
  fingerprint: string;
  source: "render" | "upscale" | "segmentation";
  category: AdminFailureCategory;
  jobType: string;
  model: string;
  /** The error with ids and numbers masked, so repeats of one problem group together. */
  message: string;
  count: number;
  affectedUsers: number;
  firstSeen: string;
  lastSeen: string;
  sampleId: string;
}

export interface AdminPerformanceFailuresResponse {
  range: AdminPerformanceRange;
  byCategory: { category: AdminFailureCategory; count: number }[];
  groups: AdminFailureGroup[];
}

// ── Studio Control ────────────────────────────────────────────────────────────────

/**
 * Studio capabilities an operator can switch, scope to plans, or roll out gradually. Keys are
 * stable: published revisions and jobs refer to them.
 */
export type StudioFeatureKey =
  | "render.standard"
  | "render.references"
  | "render.fidelity"
  | "edit.standard"
  | "edit.references"
  | "render.upscale"
  | "export.4k"
  | "export.8k"
  | "selection.click"
  | "selection.prompt";

export interface StudioFeatureDefinition {
  key: StudioFeatureKey;
  label: string;
  description: string;
  group: "Render" | "Edit" | "Resolution" | "Auto select";
}

export const STUDIO_FEATURES: readonly StudioFeatureDefinition[] = [
  { key: "render.standard", label: "Standard render", description: "Render from a photo, 3D massing or line drawing with a prompt.", group: "Render" },
  { key: "render.references", label: "Reference render", description: "Render with style or material reference images.", group: "Render" },
  { key: "render.fidelity", label: "Strict fidelity", description: "Reference render that locks the source design's geometry.", group: "Render" },
  { key: "edit.standard", label: "Edit", description: "Change part or all of a finished render with an instruction.", group: "Edit" },
  { key: "edit.references", label: "Edit with references", description: "Edit using reference images.", group: "Edit" },
  { key: "render.upscale", label: "Upscale a finished render", description: "Upscale an existing render from its card.", group: "Resolution" },
  { key: "export.4k", label: "4K output", description: "Deliver renders or upscales at 4K.", group: "Resolution" },
  { key: "export.8k", label: "8K output", description: "Deliver renders or upscales at 8K.", group: "Resolution" },
  { key: "selection.click", label: "Click selection", description: "Auto select an object by clicking it.", group: "Auto select" },
  { key: "selection.prompt", label: "Prompt selection", description: "Auto select objects by describing them.", group: "Auto select" },
];

/**
 * enforce: refuse requests the rule doesn't allow. observe: allow them, but log that the rule
 * would have refused — the way to try a rule against real traffic before switching it on.
 */
export type StudioFeatureEnforcement = "enforce" | "observe";

export interface StudioFeatureRule {
  enabled: boolean;
  enforcement: StudioFeatureEnforcement;
  /** Plan slugs that may use it; null = every plan. */
  allowedPlans: string[] | null;
  /** 0–100: the share of users (stable per user) who get it. */
  rolloutPercent: number;
  /** Shown to the user when they can't use it; null = the Studio's own wording. */
  message: string | null;
}

export interface StudioConfig {
  features: Record<StudioFeatureKey, StudioFeatureRule>;
  /** Published credit prices; absent or null = Settings' creditsPerImage / creditsPerSelection. */
  credits?: CreditPrices | null;
  /** Holds on individual models, by model id; a model not listed runs normally. */
  models?: Record<string, ModelRule>;
}

/** Everything on for everyone: exactly how the Studio behaved before Studio Control. */
export function defaultStudioConfig(): StudioConfig {
  const rule = (): StudioFeatureRule => ({ enabled: true, enforcement: "enforce", allowedPlans: null, rolloutPercent: 100, message: null });
  return { features: Object.fromEntries(STUDIO_FEATURES.map((feature) => [feature.key, rule()])) as Record<StudioFeatureKey, StudioFeatureRule> };
}

/** The features a render, edit or upscale request uses. */
export function featuresForRender(settings: RenderGenerationSettings): StudioFeatureKey[] {
  const base: Record<RenderRoute, StudioFeatureKey> = {
    photo: "render.standard",
    drawing: "render.standard",
    references: "render.references",
    fidelity: "render.fidelity",
    edit: "edit.standard",
    "edit-references": "edit.references",
    upscale: "render.upscale",
  };
  const keys: StudioFeatureKey[] = [base[renderRouteFor(settings)]];
  const target = settings.upscale?.target ?? settings.highRes?.target;
  if (target) keys.push(target === "8k" ? "export.8k" : "export.4k");
  return keys;
}

/** The features an automatic selection uses: a click, a prompt, or both. */
export function featuresForSelection(request: { prompt?: string | null; point?: unknown }): StudioFeatureKey[] {
  const keys: StudioFeatureKey[] = [];
  if (request.point) keys.push("selection.click");
  if (request.prompt) keys.push("selection.prompt");
  return keys;
}

/** A stable 0–99 bucket per user and feature (FNV-1a), so a partial rollout doesn't flicker. */
export function rolloutBucket(userId: string, key: StudioFeatureKey): number {
  let hash = 0x811c9dc5;
  for (const char of `${userId}:${key}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}

/**
 * Features only some plans include, whatever Studio Control says: Studio Control can narrow
 * these further but never open them to another plan. A feature not listed is in every plan.
 */
export const PLAN_FEATURES: Partial<Record<StudioFeatureKey, readonly string[]>> = {
  "export.4k": ["studio", "team"],
  "export.8k": ["team"],
};

export function planIncludesFeature(planSlug: string, key: StudioFeatureKey): boolean {
  const plans = PLAN_FEATURES[key];
  return !plans || plans.includes(planSlug);
}

/** paused: the model behind it is paused in the Model Registry. */
export type StudioFeatureDenial = "disabled" | "plan" | "rollout" | "paused";

/** Why a rule refuses this user, or null when it allows them. Ignores the enforcement mode. */
export function featureDenial(
  rule: StudioFeatureRule,
  user: { id: string; planSlug: string; betaFeatureGrants?: readonly string[] },
  key: StudioFeatureKey,
): Exclude<StudioFeatureDenial, "paused"> | null {
  if (!rule.enabled) return "disabled";
  // A running beta program can grant a feature beyond the plan; an operator switch still wins.
  if (rule.allowedPlans && !rule.allowedPlans.includes(user.planSlug) && !user.betaFeatureGrants?.includes(key)) return "plan";
  if (rule.rolloutPercent < 100 && rolloutBucket(user.id, key) >= rule.rolloutPercent) return "rollout";
  return null;
}

export interface StudioFeatureAvailability {
  available: boolean;
  /** Why it's unavailable; null when available. */
  reason: StudioFeatureDenial | null;
  message: string | null;
}

export type MaintenanceScope = "all" | "renders" | "selections";

export interface MaintenanceWindow {
  id: string;
  scope: MaintenanceScope;
  startsAt: string;
  endsAt: string;
  message: string | null;
  reason: string;
  createdByEmail: string | null;
  cancelledAt: string | null;
  cancelledByEmail: string | null;
  createdAt: string;
  /** Derived from the times: upcoming, active, ended or cancelled. */
  state: "upcoming" | "active" | "ended" | "cancelled";
}

export interface StudioConfigRevision {
  version: number;
  checksum: string;
  reason: string;
  publishedByEmail: string | null;
  /** Set when this revision restored an earlier one. */
  restoredFrom: number | null;
  approvalId: string | null;
  createdAt: string;
}

export interface AdminStudioControlResponse {
  current: StudioConfigRevision & { config: StudioConfig };
  revisions: StudioConfigRevision[];
  features: readonly StudioFeatureDefinition[];
  plans: { slug: string; name: string }[];
  /** Requests a rule in observe mode would have refused, per feature and reason, over 7 days. */
  observations: { key: StudioFeatureKey; reason: StudioFeatureDenial; last24h: number; last7d: number; users7d: number }[];
  maintenance: {
    /** The on/off switches in Settings; they still work alongside scheduled windows. */
    switches: { renders: boolean; selections: boolean; message: string | null };
    windows: MaintenanceWindow[];
  };
  /** Studio changes and maintenance windows waiting for a second admin, or to be executed. */
  pendingApprovals: { id: string; action: ApprovalAction; status: "pending" | "approved"; reason: string; createdAt: string }[];
}

export interface AdminPublishStudioConfigRequest {
  /** The version the change was made against; publishing fails if another one landed since. */
  expectedVersion: number;
  config: StudioConfig;
  reason: string;
}

export type AdminPublishStudioConfigResponse =
  | { version: number; checksum: string }
  | { pendingApproval: true; approvalId: string };

export interface AdminCreateMaintenanceWindowRequest {
  scope: MaintenanceScope;
  startsAt: string;
  endsAt: string;
  message: string | null;
  reason: string;
}

export type AdminMaintenanceWindowResponse = { window: MaintenanceWindow } | { pendingApproval: true; approvalId: string };

// ── Credit prices ─────────────────────────────────────────────────────────────────

/** What each action costs in credits. Absolute: no other multiplier applies on top. */
export interface CreditPrices {
  /** A photo, massing or drawing render. */
  render: number;
  /** A render with reference images. */
  references: number;
  /** A strict-fidelity reference render. */
  fidelity: number;
  /** Each pass of an edit (most edits are one pass; a selection plus an environment change is two). */
  editPass: number;
  /** Added for a 4K copy, or charged for a standalone 4K upscale. */
  upscale4k: number;
  /** Added for an 8K copy, or charged for a standalone 8K upscale. */
  upscale8k: number;
  /** One automatic selection. */
  selection: number;
}

/**
 * The prices before any were published: the route's fixed weight times the operator's
 * creditsPerImage (creditsPerSelection for selections). creditsForRender with these prices
 * equals baseCreditCostForRender(settings) * creditsPerImage for every request.
 */
export function legacyCreditPrices(creditsPerImage: number, creditsPerSelection: number): CreditPrices {
  return {
    render: creditsPerImage,
    references: creditsPerImage,
    fidelity: 2 * creditsPerImage,
    editPass: creditsPerImage,
    upscale4k: upscaleCreditCost("4k") * creditsPerImage,
    upscale8k: upscaleCreditCost("8k") * creditsPerImage,
    selection: creditsPerSelection,
  };
}

export function upscaleCredits(target: UpscaleTarget, prices: CreditPrices): number {
  return target === "8k" ? prices.upscale8k : prices.upscale4k;
}

/** Credits a render, edit or upscale request costs at these prices. */
export function creditsForRender(settings: RenderGenerationSettings, prices: CreditPrices): number {
  if (settings.upscale) return upscaleCredits(settings.upscale.target, prices);
  if (settings.edit) return editPassCount(settings.edit) * prices.editPass;
  const hasReferences = (settings.referenceImageUrls?.length ?? 0) > 0;
  const render = hasReferences ? (settings.fidelity?.mode === "strict" ? prices.fidelity : prices.references) : prices.render;
  return render + (settings.highRes ? upscaleCredits(settings.highRes.target, prices) : 0);
}

export const CREDIT_PRICE_LABELS: Record<keyof CreditPrices, string> = {
  render: "Render",
  references: "Reference render",
  fidelity: "Strict fidelity render",
  editPass: "Edit (per pass)",
  upscale4k: "4K output or upscale",
  upscale8k: "8K output or upscale",
  selection: "Auto select",
};

// ── Model Registry ────────────────────────────────────────────────────────────────

/** An operator's hold on a model: paused models take no new jobs; running ones finish. */
export interface ModelRule {
  paused: boolean;
  message: string | null;
}

export interface AdminModel {
  id: string;
  provider: "fal" | "mock";
  /** Estimated USD per image, used for the budget and cost reporting. */
  costUsd: number;
  /** The routes it serves, per engine mode. Declared in code: each needs its own input format. */
  serves: { mode: RenderEngineMode; route: RenderRoute | "selection" | "selection-click" }[];
  /** True when it serves a route in the engine mode in force now. */
  inUse: boolean;
  rule: ModelRule;
  /** Studio features that stop while it's paused (in the current mode). */
  affects: StudioFeatureKey[];
  stats: {
    jobs: number;
    succeeded: number;
    failed: number;
    successRate: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    samples: number;
    costUsd: number;
    lastUsedAt: string | null;
  };
}

export interface AdminModelsResponse {
  mode: RenderEngineMode;
  configVersion: number;
  models: AdminModel[];
}

// ── Plans and pricing ─────────────────────────────────────────────────────────────

export interface AdminPlanTerms {
  name: string;
  description: string;
  currency: string;
  priceCents: number;
  interval: "none" | "month";
  /** Absent in versions recorded before yearly billing existed. */
  yearlyPriceCents?: number | null;
  monthlyCredits: number;
  dailyRenderLimit: number | null;
  monthlyRenderLimit: number | null;
  maxProjects: number | null;
  concurrentRenderLimit: number | null;
  isActive: boolean;
  paypalPlanId: string | null;
  paypalYearlyPlanId?: string | null;
  paystackPlanCode?: string | null;
  paystackYearlyPlanCode?: string | null;
}

export interface AdminPlanVersion {
  version: number;
  terms: AdminPlanTerms;
  reason: string;
  createdByEmail: string | null;
  createdAt: string;
}

export interface AdminPlan extends AdminPlanTerms {
  id: string;
  slug: string;
  /** Latest recorded version; send it back as expectedVersion when editing. */
  version: number;
  subscribers: number;
  versions: AdminPlanVersion[];
  /** Studio features this plan's users get under the configuration in force. */
  features: { key: StudioFeatureKey; available: boolean }[];
}

export interface AdminCreditPackTerms {
  name: string;
  currency: string;
  priceCents: number;
  credits: number;
  isActive: boolean;
}

export interface AdminCreditPack extends AdminCreditPackTerms {
  id: string;
  sku: string;
  version: number;
  purchases: number;
  versions: { version: number; terms: AdminCreditPackTerms; reason: string; createdByEmail: string | null; createdAt: string }[];
}

export interface AdminPlansResponse {
  plans: AdminPlan[];
  packs: AdminCreditPack[];
  /** The prices charged now, and whether they were published or come from Settings. */
  creditPrices: { prices: CreditPrices; source: "published" | "settings"; configVersion: number };
}

export type AdminCommercialChangeResponse =
  | { id: string; version: number }
  | { pendingApproval: true; approvalId: string };

export interface AdminPricingSimulationRequest {
  /** Proposed prices; omitted = the prices charged now. */
  prices?: CreditPrices;
  planSlug: string;
  periodDays: number;
  usage: {
    renders: number;
    referenceRenders: number;
    fidelityRenders: number;
    edits: number;
    upscale4k: number;
    upscale8k: number;
    selections: number;
  };
}

export interface AdminPricingSimulationResponse {
  creditsByAction: { action: keyof CreditPrices; count: number; credits: number }[];
  creditsNeeded: number;
  includedCredits: number;
  /** Credits beyond the plan's allowance, bought at the best-value active pack. */
  extraCredits: number;
  packsNeeded: { sku: string; name: string; count: number; costCents: number } | null;
  /** Provider cost at the production models' estimated prices. */
  providerCostUsd: number;
  revenueUsd: number;
  /** Revenue minus provider cost only: payment fees, refunds, tax and infrastructure are left out. */
  contributionUsd: number;
  notes: string[];
}

// ── Beta program ──────────────────────────────────────────────────────────────────

export type BetaProgramStatus = "draft" | "active" | "paused" | "ended";
export type BetaEnrollmentStatus = "active" | "suspended" | "completed" | "revoked";
export type BetaInvitationKind = "email" | "link" | "existing_user";
/** Derived: redeemed once every redemption is used, expired past its date, revoked by an operator. */
export type BetaInvitationState = "pending" | "redeemed" | "expired" | "revoked";

/** Occupied slots: active and suspended testers plus open invitation slots never exceed maxTesters. */
export interface BetaProgramCapacity {
  maxTesters: number;
  active: number;
  suspended: number;
  /** Unused redemptions of invitations that are neither revoked nor expired. */
  pendingSlots: number;
  free: number;
}

export interface AdminBetaProgram {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: BetaProgramStatus;
  startsAt: string;
  endsAt: string;
  maxTesters: number;
  creditsPerTester: number;
  maxCreditsPerTester: number;
  creditPool: number | null;
  budgetUsd: number;
  budgetWarningPercent: number;
  dailyRenderLimit: number | null;
  monthlyRenderLimit: number | null;
  concurrentRenderLimit: number | null;
  featureGrants: StudioFeatureKey[];
  downloadsUnlocked: boolean;
  welcome: BetaWelcome | null;
  attachmentBudgetMb: number;
  createdAt: string;
  updatedAt: string;
  capacity: BetaProgramCapacity;
  /** Budgeted fal cost of the program's beta-funded jobs that haven't failed. */
  spentUsd: number;
  creditsGranted: number;
}

export interface AdminBetaEnrollment {
  id: string;
  programId: string;
  userId: string;
  email: string;
  status: BetaEnrollmentStatus;
  cohort: string | null;
  profession: string | null;
  creditsGranted: number;
  /** The user's beta credits now; 0 once the enrollment has ended. */
  betaCredits: number;
  /** Effective end: the tester's own extension, else the program's end. */
  endsAt: string;
  /** Set when this tester was extended individually. */
  endsAtOverride: string | null;
  enrolledAt: string;
  endedAt: string | null;
  endedReason: string | null;
  welcomeSeenAt: string | null;
  tourCompletedAt: string | null;
}

export interface AdminBetaInvitation {
  id: string;
  programId: string;
  kind: BetaInvitationKind;
  email: string | null;
  userId: string | null;
  userEmail: string | null;
  maxRedemptions: number;
  redemptions: number;
  creditsOverride: number | null;
  cohort: string | null;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  createdByEmail: string | null;
  state: BetaInvitationState;
}

/** One account's beta history, for its page in the admin. */
export interface AdminUserBetaStatus {
  enrollments: {
    id: string;
    programId: string;
    programName: string;
    status: BetaEnrollmentStatus;
    cohort: string | null;
    creditsGranted: number;
    enrolledAt: string;
    endsAt: string;
  }[];
  invitations: (AdminBetaInvitation & { programName: string })[];
}

export interface AdminBetaProgramsResponse {
  programs: AdminBetaProgram[];
}

export interface AdminBetaProgramDetailResponse {
  program: AdminBetaProgram;
  enrollments: AdminBetaEnrollment[];
  invitations: AdminBetaInvitation[];
  missions: AdminBetaMission[];
  announcements: AdminBetaAnnouncement[];
}

/** The token is returned once, here, and never stored or shown again. */
export interface AdminBetaInvitationCreated {
  invitation: AdminBetaInvitation;
  token: string;
  /** Studio path that redeems it: /beta/join?t=<token>. */
  joinPath: string;
  /** Full link when STUDIO_URL is configured; otherwise build it from the Studio's address. */
  joinUrl: string | null;
  /** True when Clerk sent its invitation email to a new address. */
  emailSent: boolean;
}

/** What an invitation link shows before (or without) signing in. */
export interface BetaInvitationPreview {
  programName: string;
  programDescription: string;
  kind: BetaInvitationKind;
  state: BetaInvitationState | "closed";
  /** For email invitations, the invited address masked (a•••@example.com). */
  invitedEmail: string | null;
  credits: number;
  endsAt: string;
}

export interface BetaInvitationAccepted {
  enrollmentId: string;
  programId: string;
  programName: string;
  creditsGranted: number;
  /** True when this account was already enrolled through this invitation or program. */
  alreadyEnrolled: boolean;
}

/** A testing task, with how far this tester has got on it. */
export interface BetaMission {
  id: string;
  title: string;
  instructions: string;
  required: boolean;
  /** "manual" missions are ticked by the tester; the rest are verified from what they actually did. */
  kind: BetaMissionRule["kind"];
  /** For verified missions: how many qualifying results so far, out of `target`. */
  count: number;
  target: number;
  completedAt: string | null;
}

export interface BetaAnnouncement {
  id: string;
  title: string;
  body: string;
  severity: "info" | "important";
  publishedAt: string;
  unread: boolean;
}

/** Everything the Beta Program area shows a tester. */
export interface BetaTester {
  enrollmentId: string;
  status: "active" | "suspended";
  /** Beta-funded jobs are accepted now (enrollment and program active, inside the dates). */
  running: boolean;
  program: {
    id: string;
    name: string;
    description: string;
    status: BetaProgramStatus;
    welcome: BetaWelcome | null;
    downloadsUnlocked: boolean;
    featureGrants: StudioFeatureKey[];
  };
  enrolledAt: string;
  /** When this tester's access ends, including any extension. */
  endsAt: string;
  credits: { remaining: number; granted: number };
  welcomeSeenAt: string | null;
  tourCompletedAt: string | null;
  missions: BetaMission[];
  announcements: BetaAnnouncement[];
  unreadAnnouncements: number;
  /** Replies from the team on the tester's reports since they last read them. */
  unreadReplies: number;
}

export interface BetaMeResponse {
  /** Null when the user has no live enrollment. */
  tester: BetaTester | null;
  /** Invitations addressed to the user that they can accept in the Studio. */
  invitations: BetaPendingInvitation[];
}

export interface AdminBetaMission {
  id: string;
  programId: string;
  position: number;
  title: string;
  instructions: string;
  rule: BetaMissionRule;
  required: boolean;
  /** Testers who have completed it. */
  completions: number;
}

export interface AdminBetaAnnouncement {
  id: string;
  programId: string;
  title: string;
  body: string;
  severity: "info" | "important";
  publishedAt: string;
  expiresAt: string | null;
}

export type BetaFeedbackKind = "bug" | "visual_quality" | "usability" | "suggestion" | "praise";
export type BetaSeverity = "low" | "medium" | "high" | "critical";
export type BetaFeedbackStatus =
  | "new"
  | "triaged"
  | "investigating"
  | "fix_in_progress"
  | "ready_to_verify"
  | "resolved"
  | "duplicate"
  | "expected"
  | "cannot_reproduce"
  | "declined";

export interface CreateBetaFeedbackRequest {
  kind: BetaFeedbackKind;
  category: BetaFeedbackCategory;
  title: string;
  description: string;
  severity: BetaSeverity;
  /** The render being reported; the server copies its diagnostics from its own records. */
  renderId?: string | null;
  projectId?: string | null;
  canvasNodeId?: string | null;
  annotations?: BetaAnnotations | null;
  /** Build the Studio is running, e.g. a commit SHA. */
  appVersion?: string | null;
  /** The last X-Request-Id the Studio saw for this render, if any. */
  requestId?: string | null;
  viewport?: string | null;
}

/** One entry in a report's thread, as the tester sees it. */
export interface BetaFeedbackComment {
  id: string;
  kind: "comment" | "status_change" | "request_info";
  body: string;
  /** True for the Renvia team, false for the tester's own messages. */
  fromTeam: boolean;
  /** For status changes: the new status. */
  status: BetaFeedbackStatus | null;
  createdAt: string;
}

export interface BetaFeedbackSummary {
  id: string;
  /** Shown as BETA-<number>. */
  number: number;
  kind: BetaFeedbackKind;
  category: BetaFeedbackCategory;
  title: string;
  status: BetaFeedbackStatus;
  renderId: string | null;
  createdAt: string;
  updatedAt: string;
  /** The team is waiting on the tester: a question, or a fix to confirm. */
  awaitingTester: boolean;
}

export interface BetaFeedbackDetail extends BetaFeedbackSummary {
  description: string;
  severity: BetaSeverity;
  annotations: BetaAnnotations | null;
  /** Signed, expiring links to the reported render and the tester's screenshot. */
  resultImageUrl: string | null;
  sourceImageUrl: string | null;
  attachmentUrl: string | null;
  comments: BetaFeedbackComment[];
}

/** A problem the team has confirmed and shared with every tester in the program. */
export interface BetaKnownIssue {
  id: string;
  number: number;
  title: string;
  category: BetaFeedbackCategory;
  status: BetaFeedbackStatus;
  /** Testers who said they have it too. */
  plusOnes: number;
  /** The signed-in tester is one of them, or reported it. */
  mine: boolean;
}

export interface AdminBetaFeedbackSummary {
  id: string;
  number: number;
  programId: string;
  testerEmail: string;
  kind: BetaFeedbackKind;
  category: BetaFeedbackCategory;
  title: string;
  status: BetaFeedbackStatus;
  severity: BetaSeverity | null;
  severityReported: BetaSeverity;
  knownIssue: boolean;
  assigneeId: string | null;
  assigneeEmail: string | null;
  renderId: string | null;
  hasAttachment: boolean;
  plusOnes: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminBetaFeedbackComment {
  id: string;
  authorEmail: string | null;
  fromTeam: boolean;
  visibility: "tester" | "internal";
  kind: "comment" | "status_change" | "request_info";
  body: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface AdminBetaFeedbackDetail extends AdminBetaFeedbackSummary {
  description: string;
  annotations: BetaAnnotations | null;
  /** Copied from Renvia's own records when the report was filed. */
  diagnostics: Record<string, unknown> | null;
  projectId: string | null;
  canvasNodeId: string | null;
  render: { status: string; jobType: string | null; model: string | null; sourceImageUrl: string | null; resultImageUrl: string | null } | null;
  attachmentUrl: string | null;
  knownIssueTitle: string | null;
  githubUrl: string | null;
  duplicateOf: { id: string; number: number } | null;
  duplicates: number;
  resolvedAt: string | null;
  comments: AdminBetaFeedbackComment[];
}

export interface AdminBetaFeedbackListResponse {
  feedback: AdminBetaFeedbackSummary[];
  /** Reports per status across the filtered program(s), for the inbox tabs. */
  counts: Partial<Record<BetaFeedbackStatus, number>>;
}

/** An invitation addressed to the signed-in user, accepted in-app without a link. */
export interface BetaPendingInvitation {
  id: string;
  programName: string;
  programDescription: string;
  credits: number;
  expiresAt: string;
  endsAt: string;
  /** Full-resolution downloads are unlocked for the program's testers. */
  downloadsUnlocked: boolean;
  /** Studio features the program unlocks for its testers. */
  featureGrants: StudioFeatureKey[];
  invitedAt: string;
}

/** Who pays for a charged job from an active tester: their beta credits, or (by explicit choice) their own. */
export type BetaFunding = "beta" | "account";

/** Tester-facing copy for a program's welcome modal. */
export interface BetaWelcome {
  heading: string;
  body: string;
  benefits: string[];
  expectations: string[];
}

export type BetaFeedbackCategory =
  | "architecture_changed"
  | "materials_wrong"
  | "render_failed"
  | "render_stuck"
  | "edit_wrong"
  | "ui_problem"
  | "billing_credits"
  | "other";

/** How a mission is verified: from records Renvia already keeps, or by the tester's own tick. */
export type BetaMissionRule =
  | { kind: "render_succeeded"; jobTypes?: string[]; count: number }
  | { kind: "selection_succeeded"; count: number }
  | { kind: "feedback_submitted"; categories?: BetaFeedbackCategory[]; count: number }
  | { kind: "manual" };

/** Marks on a reported image, in image-normalized coordinates (0–1) so they survive zoom and pan. */
export interface BetaAnnotations {
  v: 1;
  image: "result" | "source";
  pins: { x: number; y: number; label?: string }[];
  boxes: { x: number; y: number; w: number; h: number }[];
  strokes: { points: [number, number][] }[];
}
