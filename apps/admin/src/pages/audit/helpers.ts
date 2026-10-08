import type { AdminAuditAction, AdminAuditEvent, AdminAuditRange } from "@renvia/types";
import { AlertTriangle, Coins, Settings, Shield, ScrollText, UserRound, Users } from "lucide-react";
import { formatDay, formatNumber } from "../../lib/format";

export const PAGE_SIZE = 30;

export type ActionFilter = "" | AdminAuditAction;

export type RangeFilter = "" | AdminAuditRange;

export const ACTIONS: { value: ActionFilter; label: string }[] = [
  { value: "", label: "All" },
  { value: "credits.adjust", label: "Credits" },
  { value: "user.update", label: "Users" },
  { value: "settings.update", label: "Settings" },
  { value: "render.refresh", label: "Render recovery" },
  { value: "render.cancel", label: "Render cancellation" },
  { value: "segmentation.recover", label: "Segmentation recovery" },
  { value: "incident.update", label: "Incident update" },
  { value: "billing.payment", label: "Payments" },
];

export const RANGES: { value: RangeFilter; label: string }[] = [
  { value: "", label: "All time" },
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

export const ACTION_META: Record<
  AdminAuditAction,
  { label: string; tone: "amber" | "blue" | "neutral"; icon: typeof Coins; chip: string }
> = {
  "credits.adjust": {
    label: "Credits",
    tone: "amber",
    icon: Coins,
    chip: "bg-[#f8ebe3] text-[#8a3d14]",
  },
  "user.update": {
    label: "User",
    tone: "blue",
    icon: Users,
    chip: "bg-blueprint-soft text-blueprint",
  },
  "settings.update": {
    label: "Settings",
    tone: "neutral",
    icon: Settings,
    chip: "bg-surface-muted text-secondary",
  },
  "render.refresh": { label: "Render refresh", tone: "blue", icon: Settings, chip: "bg-blueprint-soft text-blueprint" },
  "render.cancel": { label: "Render cancel", tone: "amber", icon: AlertTriangle, chip: "bg-[#f8ebe3] text-[#8a3d14]" },
  "segmentation.recover": { label: "Selection recovery", tone: "blue", icon: Settings, chip: "bg-blueprint-soft text-blueprint" },
  "incident.update": { label: "Incident", tone: "amber", icon: AlertTriangle, chip: "bg-[#f8ebe3] text-[#8a3d14]" },
  "billing.webhook": { label: "Billing webhook", tone: "neutral", icon: ScrollText, chip: "bg-surface-muted text-secondary" },
  "billing.payment": { label: "Billing payment", tone: "amber", icon: Coins, chip: "bg-[#f8ebe3] text-[#8a3d14]" },
  "billing.entitlement": { label: "Entitlement", tone: "blue", icon: Shield, chip: "bg-blueprint-soft text-blueprint" },
  "customer.note": { label: "Customer note", tone: "blue", icon: UserRound, chip: "bg-blueprint-soft text-blueprint" },
  "customer.tag": { label: "Customer tag", tone: "blue", icon: UserRound, chip: "bg-blueprint-soft text-blueprint" },
  "user.session_revoke": { label: "Session revoke", tone: "amber", icon: Shield, chip: "bg-[#f8ebe3] text-[#8a3d14]" },
  "approval.request": { label: "Approval requested", tone: "amber", icon: Shield, chip: "bg-[#f8ebe3] text-[#8a3d14]" },
  "approval.approve": { label: "Approval granted", tone: "blue", icon: Shield, chip: "bg-blueprint-soft text-blueprint" },
  "approval.reject": { label: "Approval rejected", tone: "amber", icon: Shield, chip: "bg-[#f8ebe3] text-[#8a3d14]" },
  "approval.execute": { label: "Approval executed", tone: "blue", icon: Shield, chip: "bg-blueprint-soft text-blueprint" },
  "audit.export": { label: "Audit export", tone: "neutral", icon: ScrollText, chip: "bg-surface-muted text-secondary" },
};

export function groupByDay(events: AdminAuditEvent[]) {
  const map = new Map<string, AdminAuditEvent[]>();
  for (const event of events) {
    const day = event.createdAt.slice(0, 10);
    const list = map.get(day) ?? [];
    list.push(event);
    map.set(day, list);
  }
  return [...map.entries()].map(([day, entries]) => ({
    day,
    label: formatDay(day),
    entries,
  }));
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function formatSettingValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return formatNumber(value);
  return String(value);
}
