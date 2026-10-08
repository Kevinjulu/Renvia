import type { AdminCreditDirection, AdminCreditEntry, AdminCreditSort, CreditLedgerReason } from "@renvia/types";
import { formatDay } from "../../lib/format";

export const PAGE_SIZE = 30;

export type ReasonFilter = "" | CreditLedgerReason;

export type DirectionFilter = "" | AdminCreditDirection;

export const DIRECTIONS: { value: DirectionFilter; label: string }[] = [
  { value: "", label: "All" },
  { value: "in", label: "Credits in" },
  { value: "out", label: "Credits out" },
];

export const SORTABLE: { key: AdminCreditSort; label: string }[] = [
  { key: "createdAt", label: "Newest" },
  { key: "amount", label: "Amount" },
];

export const REASON_TONE: Partial<Record<CreditLedgerReason, "emerald" | "red" | "amber" | "blue" | "neutral">> = {
  admin_grant: "blue",
  signup_bonus: "emerald",
  initial_grant: "emerald",
  purchase: "emerald",
  subscription_grant: "emerald",
  purchase_refund: "amber",
  subscription_expiry: "amber",
  render: "red",
  segment: "red",
  render_refund: "amber",
  segment_refund: "amber",
};

export function groupByDay(entries: AdminCreditEntry[]) {
  const map = new Map<string, AdminCreditEntry[]>();
  for (const entry of entries) {
    const day = entry.createdAt.slice(0, 10);
    const list = map.get(day) ?? [];
    list.push(entry);
    map.set(day, list);
  }
  return [...map.entries()].map(([day, dayEntries]) => ({
    day,
    label: formatDay(day),
    entries: dayEntries,
    net: dayEntries.reduce((sum, entry) => sum + entry.amount, 0),
  }));
}

export function reasonBarColor(reason: CreditLedgerReason): string {
  if (reason === "render" || reason === "segment") return "bg-[#c45c26]";
  if (reason === "render_refund" || reason === "segment_refund") return "bg-glow";
  if (reason === "admin_grant") return "bg-blueprint";
  return "bg-emerald-500";
}

export function reasonDotColor(reason: CreditLedgerReason): string {
  if (reason === "render" || reason === "segment") return "bg-[#c45c26]";
  if (reason === "render_refund" || reason === "segment_refund") return "bg-glow";
  if (reason === "admin_grant") return "bg-blueprint";
  return "bg-emerald-500";
}
