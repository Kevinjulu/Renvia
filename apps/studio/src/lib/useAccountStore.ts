import { create } from "zustand";
import type { MeResponse } from "@renvia/types";

/** Every new account starts with this many credits (1 credit = 1 image). */
export const FREE_CREDIT_ALLOWANCE = 25;

interface AccountState {
  /** The signed-in user's Renvia record (credits, role) — null until /me has loaded. */
  me: MeResponse | null;
  setMe: (me: MeResponse | null) => void;
}

/**
 * Shared copy of `/api/me`, so the account menu, credits pill and sidebar all show the
 * same balance. ProtectedRoute fills it on sign-in; call `refreshAccount` after anything
 * that spends credits.
 */
export const useAccountStore = create<AccountState>((set) => ({
  me: null,
  setMe: (me) => set({ me }),
}));

export function refreshAccount(getMe: () => Promise<MeResponse>) {
  return getMe()
    .then((me) => useAccountStore.getState().setMe(me))
    .catch(() => undefined);
}

export function planLabel(me: MeResponse | null): string {
  return me?.role === "admin" ? "Admin" : "Free plan";
}
