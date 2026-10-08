import type { RenderEngineMode, RenderRoute } from "@renvia/types";
import type { Draft } from "./types";

export const MODES: { value: RenderEngineMode | ""; label: string; hint: string }[] = [
  { value: "", label: "Use server default", hint: "Falls back to the FAL_MODE environment variable." },
  { value: "mock", label: "Mock", hint: "Free — returns the source image. Safe for UI testing." },
  { value: "dev", label: "Dev", hint: "Cheapest real model (~$0.003/image). Pipeline tests." },
  { value: "prod", label: "Production", hint: "Real models (~$0.04/image). Spends fal credit." },
];

export const MODE_LABEL: Record<RenderEngineMode, string> = {
  mock: "Mock (free)",
  dev: "Dev (cheap)",
  prod: "Production",
};

export const ROUTE_LABEL: Record<RenderRoute, string> = {
  photo: "Photo",
  drawing: "Drawing",
  references: "References",
  edit: "Edit",
  "edit-references": "Edit + references",
  fidelity: "Fidelity",
  upscale: "Upscale",
};

/** The five refusal messages, rendered as one block of textareas. */
export const REFUSAL_MESSAGE_FIELDS = [
  {
    key: "messageInsufficientCredits",
    label: "Out of credits",
    hint: "Shown when the balance can’t cover the next render or selection.",
    placeholder: "You’re out of credits — ping us and we’ll top you up.",
  },
  {
    key: "messageDailyLimit",
    label: "Daily limit reached",
    hint: "Shown when today’s render or selection allowance is used up.",
    placeholder: "That’s today’s allowance. Fresh credits at midnight UTC.",
  },
  {
    key: "messageMonthlyLimit",
    label: "Monthly limit reached",
    hint: "Shown when this month’s allowance is used up.",
    placeholder: "You’ve hit this month’s cap — it resets on the 1st.",
  },
  {
    key: "messageBudgetExhausted",
    label: "Render budget exhausted",
    hint: "Shown to everyone once the global fal budget is spent.",
    placeholder: "Rendering is paused while we top up the demo budget.",
  },
  {
    key: "messageAccountDisabled",
    label: "Account disabled",
    hint: "Shown to a user whose account has been switched off.",
    placeholder: "This account is disabled. Contact support to reopen it.",
  },
] as const satisfies readonly { key: keyof Draft; label: string; hint: string; placeholder: string }[];
