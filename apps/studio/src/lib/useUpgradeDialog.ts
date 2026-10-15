import { create } from "zustand";
import type { MeResponse, StudioFeatureKey } from "@renvia/types";
import { ApiError } from "./apiClient";

/** Something a plan unlocks that the user just tried to use. */
export type UpgradeTopic = "download" | "export.4k" | "export.8k";

export type PlansTab = "plans" | "credits";

interface UpgradeDialogState {
  /** Why the user was stopped, while that explanation is open. */
  topic: UpgradeTopic | null;
  /** The plans and credits popup, while it's open: which tab, and which plan to point at. */
  plans: { tab: PlansTab; highlight: string | null } | null;
  ask: (topic: UpgradeTopic) => void;
  openPlans: (options?: { tab?: PlansTab; highlight?: string | null }) => void;
  dismiss: () => void;
  closePlans: () => void;
}

/**
 * The upgrade path inside the Studio: a short "why you can't" popup, then plans and checkout
 * in a popup over the work, so nobody has to leave their project to upgrade. `ProtectedRoute`
 * renders both.
 */
export const useUpgradeDialogStore = create<UpgradeDialogState>((set) => ({
  topic: null,
  plans: null,
  ask: (topic) => set({ topic }),
  openPlans: (options) => set({ topic: null, plans: { tab: options?.tab ?? "plans", highlight: options?.highlight ?? null } }),
  dismiss: () => set({ topic: null }),
  closePlans: () => set({ plans: null }),
}));

/** Downloading and copying renders are paid-plan features; admins can always download. */
export function downloadsLocked(me: MeResponse | null): boolean {
  return me !== null && me.role !== "admin" && me.entitlement.plan.interval === "none";
}

/** The cheapest plan that includes a topic. Kept in step with the API's PLAN_FEATURES. */
export const PLAN_FOR_TOPIC: Record<UpgradeTopic, string> = {
  download: "studio",
  "export.4k": "studio",
  "export.8k": "team",
};

const FEATURE_TOPICS: Partial<Record<StudioFeatureKey, UpgradeTopic>> = { "export.4k": "export.4k", "export.8k": "export.8k" };

/** The upgrade explanation for a feature the user's plan doesn't include, or null for any other refusal. */
export function upgradeTopicFor(key: StudioFeatureKey, availability: { available: boolean; reason: string | null } | undefined): UpgradeTopic | null {
  if (!availability || availability.available || availability.reason !== "plan") return null;
  return FEATURE_TOPICS[key] ?? null;
}

/** Shows the upgrade popup if `error` is the API refusing a feature outside the user's plan. */
export function reportUpgrade(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.code !== "feature_disabled" || error.reason !== "plan" || !error.feature) return false;
  const topic = FEATURE_TOPICS[error.feature as StudioFeatureKey];
  if (!topic) return false;
  useUpgradeDialogStore.getState().ask(topic);
  return true;
}
