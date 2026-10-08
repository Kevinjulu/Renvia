import type { AdminSettings, AdminUpdateSettingsRequest, RenderEngineMode } from "@renvia/types";
import { formatNumber, formatUsd } from "../../lib/format";
import type { Draft } from "./types";
import { validateDraft } from "./draft";
import { formatMode, formatLimit, formatBudget, formatOnOff, formatMessage } from "./format";

export interface ChangeItem {
  key: string;
  label: string;
  from: string;
  to: string;
}

export function pushIfChanged(
  items: ChangeItem[],
  key: string,
  label: string,
  from: string,
  to: string,
  changed: boolean,
) {
  if (changed) items.push({ key, label, from, to });
}

export function diffChanges(settings: AdminSettings, draft: Draft): ChangeItem[] {
  const result = validateDraft(draft);
  if (!result.body) return [];
  const body = result.body;
  const items: ChangeItem[] = [];

  pushIfChanged(
    items,
    "signupBonusCredits",
    "Signup bonus",
    formatNumber(settings.signupBonusCredits),
    formatNumber(body.signupBonusCredits!),
    body.signupBonusCredits !== undefined && body.signupBonusCredits !== settings.signupBonusCredits,
  );
  pushIfChanged(
    items,
    "creditsPerImage",
    "Credits / image",
    formatNumber(settings.creditsPerImage),
    formatNumber(body.creditsPerImage!),
    body.creditsPerImage !== undefined && body.creditsPerImage !== settings.creditsPerImage,
  );
  pushIfChanged(
    items,
    "creditsPerSelection",
    "Credits / selection",
    formatNumber(settings.creditsPerSelection),
    formatNumber(body.creditsPerSelection!),
    body.creditsPerSelection !== undefined && body.creditsPerSelection !== settings.creditsPerSelection,
  );
  pushIfChanged(
    items,
    "dailyRenderLimit",
    "Daily render limit",
    formatLimit(settings.dailyRenderLimit),
    formatLimit(body.dailyRenderLimit!),
    body.dailyRenderLimit !== undefined && body.dailyRenderLimit !== settings.dailyRenderLimit,
  );
  pushIfChanged(
    items,
    "dailySegmentLimit",
    "Daily segment limit",
    formatLimit(settings.dailySegmentLimit),
    formatLimit(body.dailySegmentLimit!),
    body.dailySegmentLimit !== undefined && body.dailySegmentLimit !== settings.dailySegmentLimit,
  );
  pushIfChanged(
    items,
    "maintenanceRenders",
    "Pause renders",
    formatOnOff(settings.maintenanceRenders),
    formatOnOff(body.maintenanceRenders!),
    body.maintenanceRenders !== undefined && body.maintenanceRenders !== settings.maintenanceRenders,
  );
  pushIfChanged(
    items,
    "maintenanceSegments",
    "Pause segments",
    formatOnOff(settings.maintenanceSegments),
    formatOnOff(body.maintenanceSegments!),
    body.maintenanceSegments !== undefined && body.maintenanceSegments !== settings.maintenanceSegments,
  );
  pushIfChanged(
    items,
    "maintenanceMessage",
    "Maintenance message",
    formatMessage(settings.maintenanceMessage),
    formatMessage(body.maintenanceMessage ?? null),
    body.maintenanceMessage !== undefined && body.maintenanceMessage !== settings.maintenanceMessage,
  );
  pushIfChanged(
    items,
    "budgetWarningPercent",
    "Budget warning %",
    `${settings.budgetWarningPercent}%`,
    `${body.budgetWarningPercent!}%`,
    body.budgetWarningPercent !== undefined && body.budgetWarningPercent !== settings.budgetWarningPercent,
  );
  pushIfChanged(
    items,
    "budgetCriticalPercent",
    "Budget critical %",
    `${settings.budgetCriticalPercent}%`,
    `${body.budgetCriticalPercent!}%`,
    body.budgetCriticalPercent !== undefined && body.budgetCriticalPercent !== settings.budgetCriticalPercent,
  );
  pushIfChanged(
    items,
    "stuckTimeoutMinutes",
    "Stuck timeout",
    `${settings.stuckTimeoutMinutes}m`,
    `${body.stuckTimeoutMinutes!}m`,
    body.stuckTimeoutMinutes !== undefined && body.stuckTimeoutMinutes !== settings.stuckTimeoutMinutes,
  );
  pushIfChanged(
    items,
    "falMode",
    "Mode",
    formatMode(settings.falMode),
    formatMode(body.falMode!),
    body.falMode !== undefined && body.falMode !== settings.falMode,
  );
  pushIfChanged(
    items,
    "falBudgetUsd",
    "Budget",
    formatBudget(settings.falBudgetUsd),
    formatBudget(body.falBudgetUsd!),
    body.falBudgetUsd !== undefined && body.falBudgetUsd !== settings.falBudgetUsd,
  );

  // The newer knobs all diff the same way, so they're table-driven rather than
  // another dozen near-identical pushIfChanged calls.
  for (const { key, label, format } of EXTRA_CHANGE_FIELDS) {
    const next = body[key] as ExtraValue | undefined;
    const previous = settings[key] as ExtraValue;
    pushIfChanged(items, key, label, format(previous), format(next ?? null), next !== undefined && next !== previous);
  }
  return items;
}

export type ExtraKey = Extract<
  keyof AdminUpdateSettingsRequest,
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
>;

export type ExtraValue = number | string | null;

export const countOr = (suffix: string) => (value: ExtraValue) =>
  value === null ? "Unlimited" : `${formatNumber(Number(value))}${suffix}`;

export const plain = (suffix: string) => (value: ExtraValue) =>
  value === null ? "—" : `${formatNumber(Number(value))}${suffix}`;

export const asMessage = (value: ExtraValue) => formatMessage(value === null ? null : String(value));

export const EXTRA_CHANGE_FIELDS: { key: ExtraKey; label: string; format: (value: ExtraValue) => string }[] = [
  { key: "monthlyRenderLimit", label: "Monthly render limit", format: countOr("/mo") },
  { key: "monthlySegmentLimit", label: "Monthly selection limit", format: countOr("/mo") },
  { key: "maxCreditBalance", label: "Credit balance cap", format: countOr(" credits") },
  { key: "maxProjectsPerUser", label: "Projects per user", format: countOr("") },
  { key: "maxUploadMb", label: "Max upload", format: plain(" MB") },
  { key: "maxReferenceImages", label: "Max references", format: plain("") },
  { key: "maxPromptChars", label: "Prompt length", format: plain(" chars") },
  { key: "maxSelectionPromptChars", label: "Selection prompt length", format: plain(" chars") },
  { key: "lowCreditThreshold", label: "Low-credit warning", format: plain(" credits") },
  { key: "messageInsufficientCredits", label: "Out-of-credits message", format: asMessage },
  { key: "messageDailyLimit", label: "Daily-limit message", format: asMessage },
  { key: "messageMonthlyLimit", label: "Monthly-limit message", format: asMessage },
  { key: "messageBudgetExhausted", label: "Budget message", format: asMessage },
  { key: "messageAccountDisabled", label: "Disabled-account message", format: asMessage },
];

export function isDangerous(settings: AdminSettings, draft: Draft): string | null {
  const result = validateDraft(draft);
  if (!result.body) return null;
  const nextMode = result.body.falMode !== undefined ? result.body.falMode : settings.falMode;
  const effectiveNext: RenderEngineMode =
    nextMode === "dev" || nextMode === "prod" ? nextMode : nextMode === "mock" ? "mock" : settings.effectiveMode;
  const resolved =
    nextMode === null
      ? settings.envMode === "dev" || settings.envMode === "prod"
        ? settings.envMode
        : "mock"
      : effectiveNext;

  if (resolved === "prod" && settings.effectiveMode !== "prod") {
    return "You’re enabling production models. Every successful render will spend real fal credit.";
  }

  const nextBudget = result.body.falBudgetUsd !== undefined ? result.body.falBudgetUsd : settings.falBudgetUsd;
  if (nextBudget === 0) {
    return "Budget cap of $0 will block all paid renders immediately.";
  }
  if (typeof nextBudget === "number" && nextBudget > 0 && nextBudget < settings.spentUsd) {
    return `New budget (${formatUsd(nextBudget)}) is below current spend (${formatUsd(settings.spentUsd)}) — paid renders will pause.`;
  }

  const pausingRenders = result.body.maintenanceRenders === true && !settings.maintenanceRenders;
  const pausingSegments = result.body.maintenanceSegments === true && !settings.maintenanceSegments;
  if (pausingRenders || pausingSegments) {
    return `You’re turning on maintenance — non-admin ${[
      pausingRenders ? "renders" : null,
      pausingSegments ? "segmentations" : null,
    ]
      .filter(Boolean)
      .join(" & ")} will be blocked immediately.`;
  }

  return null;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function stringify(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return String(value);
  return String(value);
}
