import { create } from "zustand";
import { limitRefusal, type LimitRefusal } from "../components/LimitDialog";

interface LimitDialogState {
  /** The refusal currently being explained, or null when nothing is blocked. */
  refusal: LimitRefusal | null;
  /** True while the account dialog is open on the credits tab. */
  creditsOpen: boolean;
  show: (refusal: LimitRefusal) => void;
  dismiss: () => void;
  setCreditsOpen: (open: boolean) => void;
}

/**
 * One dialog for every limit refusal in the app, so an upload rejected deep in a hook
 * explains itself the same way a blocked render does. `ProtectedRoute` renders it.
 */
export const useLimitDialogStore = create<LimitDialogState>((set) => ({
  refusal: null,
  creditsOpen: false,
  show: (refusal) => set({ refusal }),
  dismiss: () => set({ refusal: null }),
  setCreditsOpen: (creditsOpen) => set({ creditsOpen }),
}));

/**
 * Shows the limit dialog if `error` is a refusal, and reports whether it handled it.
 * Callers that swallow errors can use the return value to stay quiet when it's covered.
 */
export function reportLimit(error: unknown): boolean {
  const refusal = limitRefusal(error);
  if (!refusal) return false;
  useLimitDialogStore.getState().show(refusal);
  return true;
}
