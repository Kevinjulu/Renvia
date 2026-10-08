import type { AdminSegmentationMode, AdminSegmentationSort, SegmentationStatus } from "@renvia/types";

export const PAGE_SIZE = 25;

export type StatusFilter = "" | SegmentationStatus;

export type ModeFilter = "" | AdminSegmentationMode;

export const STATUSES: { value: StatusFilter; label: string }[] = [
  { value: "", label: "All" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "pending", label: "Pending" },
];

export const MODES: { value: ModeFilter; label: string }[] = [
  { value: "", label: "All" },
  { value: "prompt", label: "Prompt" },
  { value: "click", label: "Click" },
];

export const SORTABLE: { key: AdminSegmentationSort; label: string }[] = [
  { key: "createdAt", label: "Created" },
  { key: "costUsd", label: "Cost" },
  { key: "creditsCharged", label: "Credits" },
  { key: "objectCount", label: "Objects" },
];
