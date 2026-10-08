import type { AdminUserSort } from "@renvia/types";

export const PAGE_SIZE = 25;

export const LOW_BALANCE = 5;

export type RoleFilter = "" | "user" | "analyst" | "support" | "billing" | "admin";

export type StatusFilter = "" | "active" | "disabled";

export type BalanceFilter = "" | "low" | "zero";

export const SORTABLE: { key: AdminUserSort; label: string }[] = [
  { key: "lastActiveAt", label: "Last active" },
  { key: "createdAt", label: "Joined" },
  { key: "creditBalance", label: "Credits" },
  { key: "renderCount", label: "Renders" },
  { key: "spentUsd", label: "Spend" },
];
