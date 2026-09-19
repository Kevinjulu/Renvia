import { create } from "zustand";
import type { CreditLedgerEntry, CreditLedgerReason, MeCreditsResponse, MeResponse } from "@renvia/types";

/** Ledger reasons that add spendable credits (refunds only return what was spent). */
const GRANT_REASONS: ReadonlySet<CreditLedgerReason> = new Set(["signup_bonus", "initial_grant", "admin_grant", "purchase"]);

interface AccountState {
  /** The signed-in user's Renvia record (credits, role) — null until /me has loaded. */
  me: MeResponse | null;
  /**
   * Credits granted to this account so far (signup bonus, admin grants, purchases), read
   * from the ledger — the bonus is an admin setting, so it can't be hard-coded. Null until
   * the ledger has loaded.
   */
  granted: number | null;
  setMe: (me: MeResponse | null) => void;
  setGranted: (granted: number | null) => void;
}

/**
 * Shared copy of `/api/me`, so the account menu, credits pill and sidebar all show the
 * same balance. ProtectedRoute fills it on sign-in; call `refreshAccount` after anything
 * that spends credits.
 */
export const useAccountStore = create<AccountState>((set) => ({
  me: null,
  granted: null,
  setMe: (me) => set({ me }),
  setGranted: (granted) => set({ granted }),
}));

export function refreshAccount(getMe: () => Promise<MeResponse>) {
  return getMe()
    .then((me) => useAccountStore.getState().setMe(me))
    .catch(() => undefined);
}

/** Loads the credit ledger, updates the balance and granted total, and returns the entries. */
export async function loadCreditHistory(getMyCredits: () => Promise<MeCreditsResponse>): Promise<CreditLedgerEntry[]> {
  const result = await getMyCredits();
  const { me, setMe, setGranted } = useAccountStore.getState();
  const granted = result.entries.filter((entry) => GRANT_REASONS.has(entry.reason)).reduce((sum, entry) => sum + entry.amount, 0);
  // The ledger returns only recent entries, so an old grant can fall off; never report less than the balance.
  setGranted(Math.max(granted, result.creditBalance));
  if (me && me.creditBalance !== result.creditBalance) setMe({ ...me, creditBalance: result.creditBalance });
  return result.entries;
}

/** Share of granted credits still left, 0–100 — null until the ledger has loaded. */
export function creditsLeftPercent(balance: number, granted: number | null): number | null {
  if (granted === null) return null;
  if (granted <= 0) return 0;
  return Math.min(100, Math.round((balance / granted) * 100));
}

export function planLabel(me: MeResponse | null): string {
  return me?.role === "admin" ? "Admin" : "Free plan";
}
