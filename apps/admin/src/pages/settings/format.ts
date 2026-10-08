import type { RenderEngineMode } from "@renvia/types";
import { formatNumber, formatUsd } from "../../lib/format";
import { MODE_LABEL } from "./constants";

export function formatMode(value: RenderEngineMode | "" | null): string {
  if (value === "" || value === null) return "Server default";
  return MODE_LABEL[value];
}

export function formatLimit(value: number | null | string): string {
  if (value === "" || value === null) return "Unlimited";
  return `${formatNumber(Number(value))}/day`;
}

export function formatBudget(value: number | null | string): string {
  if (value === "" || value === null) return "Env default";
  return formatUsd(Number(value));
}

export function formatOnOff(value: boolean): string {
  return value ? "On" : "Off";
}

export function formatMessage(value: string | null): string {
  if (!value?.trim()) return "None";
  const trimmed = value.trim();
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
}
