import type { AdminProjectHealth, AdminProjectSort } from "@renvia/types";

export const PAGE_SIZE = 25;

export type HealthFilter = "" | AdminProjectHealth;

export const HEALTH: { value: HealthFilter; label: string }[] = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "failures", label: "Has failures" },
  { value: "inflight", label: "In flight" },
  { value: "never", label: "Never rendered" },
  { value: "high_spend", label: "High spend" },
];

export const SORTABLE: { key: AdminProjectSort; label: string }[] = [
  { key: "renderCount", label: "Renders" },
  { key: "failedCount", label: "Failures" },
  { key: "spentUsd", label: "Spend" },
  { key: "lastRenderAt", label: "Last render" },
  { key: "updatedAt", label: "Updated" },
];
