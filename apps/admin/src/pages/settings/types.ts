import type { RenderEngineMode } from "@renvia/types";

export interface Draft {
  signupBonusCredits: string;
  dailyRenderLimit: string;
  dailySegmentLimit: string;
  monthlyRenderLimit: string;
  monthlySegmentLimit: string;
  maxCreditBalance: string;
  maxProjectsPerUser: string;
  maxUploadMb: string;
  maxReferenceImages: string;
  maxPromptChars: string;
  maxSelectionPromptChars: string;
  lowCreditThreshold: string;
  messageInsufficientCredits: string;
  messageDailyLimit: string;
  messageMonthlyLimit: string;
  messageBudgetExhausted: string;
  messageAccountDisabled: string;
  creditsPerImage: string;
  creditsPerSelection: string;
  maintenanceRenders: boolean;
  maintenanceSegments: boolean;
  maintenanceMessage: string;
  budgetWarningPercent: string;
  budgetCriticalPercent: string;
  stuckTimeoutMinutes: string;
  falMode: RenderEngineMode | "";
  falBudgetUsd: string;
}

export type FieldErrors = Partial<Record<keyof Draft, string>>;
