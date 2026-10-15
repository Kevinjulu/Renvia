import { create } from "zustand";
import type { BetaFunding, BetaMeResponse, BetaPendingInvitation, BetaTester } from "@renvia/types";

interface BetaState {
  /** True once /beta/me has answered at least once. */
  loaded: boolean;
  /** The signed-in user's beta program, or null when they aren't a tester. */
  tester: BetaTester | null;
  /** Invitations addressed to them that they can accept here. */
  invitations: BetaPendingInvitation[];
  /**
   * The tester chose to pay with their own credits after their beta credits ran out or beta was
   * paused. Kept for this session only, so beta credits are the default again next time.
   */
  payWithOwnCredits: boolean;
  /** The welcome modal is open (first visit, or replayed from the Beta menu). */
  welcomeOpen: boolean;
  setData: (data: BetaMeResponse) => void;
  setPayWithOwnCredits: (value: boolean) => void;
  setWelcomeOpen: (open: boolean) => void;
}

export const useBetaStore = create<BetaState>((set) => ({
  loaded: false,
  tester: null,
  invitations: [],
  payWithOwnCredits: false,
  welcomeOpen: false,
  setData: (data) =>
    set((state) => ({
      loaded: true,
      tester: data.tester,
      invitations: data.invitations,
      // A first visit opens the welcome; a later refresh never reopens one the tester closed.
      welcomeOpen: state.welcomeOpen || (!state.loaded && Boolean(data.tester && !data.tester.welcomeSeenAt)),
      // Nothing to choose between once they aren't a tester.
      payWithOwnCredits: data.tester ? state.payWithOwnCredits : false,
    })),
  setPayWithOwnCredits: (payWithOwnCredits) => set({ payWithOwnCredits }),
  setWelcomeOpen: (welcomeOpen) => set({ welcomeOpen }),
}));

/**
 * What charged requests send as `funding`. Undefined lets the API decide (beta credits for a
 * tester); "account" only after the tester picked "Use my own credits".
 */
export function currentFunding(): BetaFunding | undefined {
  const { tester, payWithOwnCredits } = useBetaStore.getState();
  return tester && payWithOwnCredits ? "account" : undefined;
}

/** Reloads the beta state; failures leave what was there, since the rest of the Studio works without it. */
export function refreshBeta(getBetaMe: () => Promise<BetaMeResponse>): Promise<void> {
  return getBetaMe()
    .then((data) => useBetaStore.getState().setData(data))
    .catch(() => undefined);
}

/** Days left, rounded up, never negative. */
export function daysLeft(endsAt: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - now) / (24 * 60 * 60 * 1000)));
}
