import type { AdminRenderKind, AdminRenderSort, RenderStatus } from "@renvia/types";

export const PAGE_SIZE = 25;

export type StatusFilter = "" | RenderStatus;

export type KindFilter = "" | AdminRenderKind;

export const STATUSES: { value: StatusFilter; label: string }[] = [
  { value: "", label: "All" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "processing", label: "Processing" },
  { value: "pending", label: "Pending" },
];

export const KINDS: { value: KindFilter; label: string }[] = [
  { value: "", label: "All" },
  { value: "render", label: "Render" },
  { value: "edit", label: "Edit" },
];

export const SORTABLE: { key: AdminRenderSort; label: string }[] = [
  { key: "createdAt", label: "Created" },
  { key: "costUsd", label: "Cost" },
  { key: "creditsCharged", label: "Credits" },
];
