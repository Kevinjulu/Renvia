import type { AdminSettings, AdminUpdateSettingsRequest } from "@renvia/types";
import { formatNumber } from "../../lib/format";
import type { Draft, FieldErrors } from "./types";

export function toDraft(settings: AdminSettings): Draft {
  return {
    signupBonusCredits: String(settings.signupBonusCredits),
    dailyRenderLimit: settings.dailyRenderLimit === null ? "" : String(settings.dailyRenderLimit),
    dailySegmentLimit: settings.dailySegmentLimit === null ? "" : String(settings.dailySegmentLimit),
    monthlyRenderLimit: settings.monthlyRenderLimit === null ? "" : String(settings.monthlyRenderLimit),
    monthlySegmentLimit: settings.monthlySegmentLimit === null ? "" : String(settings.monthlySegmentLimit),
    maxCreditBalance: settings.maxCreditBalance === null ? "" : String(settings.maxCreditBalance),
    maxProjectsPerUser: settings.maxProjectsPerUser === null ? "" : String(settings.maxProjectsPerUser),
    maxUploadMb: String(settings.maxUploadMb),
    maxReferenceImages: String(settings.maxReferenceImages),
    maxPromptChars: String(settings.maxPromptChars),
    maxSelectionPromptChars: String(settings.maxSelectionPromptChars),
    lowCreditThreshold: String(settings.lowCreditThreshold),
    messageInsufficientCredits: settings.messageInsufficientCredits ?? "",
    messageDailyLimit: settings.messageDailyLimit ?? "",
    messageMonthlyLimit: settings.messageMonthlyLimit ?? "",
    messageBudgetExhausted: settings.messageBudgetExhausted ?? "",
    messageAccountDisabled: settings.messageAccountDisabled ?? "",
    creditsPerImage: String(settings.creditsPerImage),
    creditsPerSelection: String(settings.creditsPerSelection),
    maintenanceRenders: settings.maintenanceRenders,
    maintenanceSegments: settings.maintenanceSegments,
    maintenanceMessage: settings.maintenanceMessage ?? "",
    budgetWarningPercent: String(settings.budgetWarningPercent),
    budgetCriticalPercent: String(settings.budgetCriticalPercent),
    stuckTimeoutMinutes: String(settings.stuckTimeoutMinutes),
    falMode: settings.falMode ?? "",
    falBudgetUsd: settings.falBudgetUsd === null ? "" : String(settings.falBudgetUsd),
  };
}

/** Blank means "no cap"; anything else must be a whole number inside the range. */
export function optionalInt(raw: string, min: number, max: number): { value: number | null; error?: string } {
  if (raw.trim() === "") return { value: null };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    return { value: null, error: `Blank (unlimited) or ${formatNumber(min)}–${formatNumber(max)}.` };
  }
  return { value };
}

export function requiredInt(raw: string, min: number, max: number): { value: number; error?: string } {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    return { value: min, error: `Whole number from ${formatNumber(min)} to ${formatNumber(max)}.` };
  }
  return { value };
}

/** Refusal copy: blank means "use the studio's built-in wording". */
export function optionalText(raw: string): { value: string | null; error?: string } {
  const trimmed = raw.trim();
  if (trimmed.length > 280) return { value: null, error: "Keep under 280 characters." };
  return { value: trimmed === "" ? null : trimmed };
}

export function validateDraft(draft: Draft): { body: AdminUpdateSettingsRequest; errors: FieldErrors } | { body: null; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const bonus = Number(draft.signupBonusCredits);
  if (!Number.isInteger(bonus) || bonus < 0 || bonus > 1000) {
    errors.signupBonusCredits = "Whole number from 0 to 1,000.";
  }
  const renderLimit = draft.dailyRenderLimit.trim() === "" ? null : Number(draft.dailyRenderLimit);
  if (renderLimit !== null && (!Number.isInteger(renderLimit) || renderLimit < 1 || renderLimit > 10_000)) {
    errors.dailyRenderLimit = "Blank (unlimited) or 1–10,000.";
  }
  const segmentLimit = draft.dailySegmentLimit.trim() === "" ? null : Number(draft.dailySegmentLimit);
  if (segmentLimit !== null && (!Number.isInteger(segmentLimit) || segmentLimit < 1 || segmentLimit > 10_000)) {
    errors.dailySegmentLimit = "Blank (unlimited) or 1–10,000.";
  }
  const creditsPerImage = Number(draft.creditsPerImage);
  if (!Number.isInteger(creditsPerImage) || creditsPerImage < 0 || creditsPerImage > 100) {
    errors.creditsPerImage = "Whole number from 0 to 100.";
  }
  const creditsPerSelection = Number(draft.creditsPerSelection);
  if (!Number.isInteger(creditsPerSelection) || creditsPerSelection < 0 || creditsPerSelection > 100) {
    errors.creditsPerSelection = "Whole number from 0 to 100.";
  }
  const warning = Number(draft.budgetWarningPercent);
  if (!Number.isInteger(warning) || warning < 1 || warning > 99) {
    errors.budgetWarningPercent = "Whole number from 1 to 99.";
  }
  const critical = Number(draft.budgetCriticalPercent);
  if (!Number.isInteger(critical) || critical < 2 || critical > 100) {
    errors.budgetCriticalPercent = "Whole number from 2 to 100.";
  }
  if (!errors.budgetWarningPercent && !errors.budgetCriticalPercent && critical <= warning) {
    errors.budgetCriticalPercent = "Must be greater than the warning percent.";
  }
  const stuck = Number(draft.stuckTimeoutMinutes);
  if (!Number.isInteger(stuck) || stuck < 1 || stuck > 1440) {
    errors.stuckTimeoutMinutes = "Whole number from 1 to 1,440 minutes.";
  }
  const budget = draft.falBudgetUsd.trim() === "" ? null : Number(draft.falBudgetUsd);
  if (budget !== null && (!Number.isFinite(budget) || budget < 0 || budget > 10_000)) {
    errors.falBudgetUsd = "Blank (env default) or $0–$10,000.";
  }
  const message = draft.maintenanceMessage.trim();
  if (message.length > 280) {
    errors.maintenanceMessage = "Keep under 280 characters.";
  }

  const monthlyRenderLimit = optionalInt(draft.monthlyRenderLimit, 1, 100_000);
  if (monthlyRenderLimit.error) errors.monthlyRenderLimit = monthlyRenderLimit.error;
  const monthlySegmentLimit = optionalInt(draft.monthlySegmentLimit, 1, 100_000);
  if (monthlySegmentLimit.error) errors.monthlySegmentLimit = monthlySegmentLimit.error;
  const maxCreditBalance = optionalInt(draft.maxCreditBalance, 1, 1_000_000);
  if (maxCreditBalance.error) errors.maxCreditBalance = maxCreditBalance.error;
  const maxProjectsPerUser = optionalInt(draft.maxProjectsPerUser, 1, 10_000);
  if (maxProjectsPerUser.error) errors.maxProjectsPerUser = maxProjectsPerUser.error;
  const maxUploadMb = requiredInt(draft.maxUploadMb, 1, 100);
  if (maxUploadMb.error) errors.maxUploadMb = maxUploadMb.error;
  const maxReferenceImages = requiredInt(draft.maxReferenceImages, 0, 16);
  if (maxReferenceImages.error) errors.maxReferenceImages = maxReferenceImages.error;
  const maxPromptChars = requiredInt(draft.maxPromptChars, 50, 8000);
  if (maxPromptChars.error) errors.maxPromptChars = maxPromptChars.error;
  const maxSelectionPromptChars = requiredInt(draft.maxSelectionPromptChars, 10, 1000);
  if (maxSelectionPromptChars.error) errors.maxSelectionPromptChars = maxSelectionPromptChars.error;
  const lowCreditThreshold = requiredInt(draft.lowCreditThreshold, 0, 1000);
  if (lowCreditThreshold.error) errors.lowCreditThreshold = lowCreditThreshold.error;

  // A daily cap above the monthly one can never be reached — flag it rather than silently ignoring it.
  if (
    !monthlyRenderLimit.error &&
    monthlyRenderLimit.value !== null &&
    renderLimit !== null &&
    renderLimit > monthlyRenderLimit.value
  ) {
    errors.monthlyRenderLimit = "Monthly limit must be at least the daily limit.";
  }
  if (
    !monthlySegmentLimit.error &&
    monthlySegmentLimit.value !== null &&
    segmentLimit !== null &&
    segmentLimit > monthlySegmentLimit.value
  ) {
    errors.monthlySegmentLimit = "Monthly limit must be at least the daily limit.";
  }
  // A signup bonus above the balance cap would be clipped on every new account.
  if (!maxCreditBalance.error && maxCreditBalance.value !== null && bonus > maxCreditBalance.value) {
    errors.maxCreditBalance = "Must be at least the signup bonus.";
  }

  const messages = {
    messageInsufficientCredits: optionalText(draft.messageInsufficientCredits),
    messageDailyLimit: optionalText(draft.messageDailyLimit),
    messageMonthlyLimit: optionalText(draft.messageMonthlyLimit),
    messageBudgetExhausted: optionalText(draft.messageBudgetExhausted),
    messageAccountDisabled: optionalText(draft.messageAccountDisabled),
  } as const;
  for (const [key, result] of Object.entries(messages)) {
    if (result.error) errors[key as keyof Draft] = result.error;
  }

  if (Object.keys(errors).length > 0) return { body: null, errors };
  return {
    body: {
      signupBonusCredits: bonus,
      dailyRenderLimit: renderLimit,
      dailySegmentLimit: segmentLimit,
      monthlyRenderLimit: monthlyRenderLimit.value,
      monthlySegmentLimit: monthlySegmentLimit.value,
      maxCreditBalance: maxCreditBalance.value,
      maxProjectsPerUser: maxProjectsPerUser.value,
      maxUploadMb: maxUploadMb.value,
      maxReferenceImages: maxReferenceImages.value,
      maxPromptChars: maxPromptChars.value,
      maxSelectionPromptChars: maxSelectionPromptChars.value,
      lowCreditThreshold: lowCreditThreshold.value,
      messageInsufficientCredits: messages.messageInsufficientCredits.value,
      messageDailyLimit: messages.messageDailyLimit.value,
      messageMonthlyLimit: messages.messageMonthlyLimit.value,
      messageBudgetExhausted: messages.messageBudgetExhausted.value,
      messageAccountDisabled: messages.messageAccountDisabled.value,
      creditsPerImage,
      creditsPerSelection,
      maintenanceRenders: draft.maintenanceRenders,
      maintenanceSegments: draft.maintenanceSegments,
      maintenanceMessage: message === "" ? null : message,
      budgetWarningPercent: warning,
      budgetCriticalPercent: critical,
      stuckTimeoutMinutes: stuck,
      falMode: draft.falMode || null,
      falBudgetUsd: budget,
    },
    errors: {},
  };
}
