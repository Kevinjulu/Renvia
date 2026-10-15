import { create } from "zustand";

const DISMISSED_KEY = "renvia.beta.dismissedInvitations";

/** Invitations the user closed with "Not now" on this device; they stay on the dashboard banner. */
export function dismissedInvitations(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(DISMISSED_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function dismissInvitation(id: string): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify([...new Set([...dismissedInvitations(), id])].slice(-20)));
  } catch {
    // Private mode or blocked storage: it simply shows again next visit.
  }
}

/** The invitation to put in front of the user on arrival: the newest one they haven't set aside. */
export function invitationToPrompt<T extends { id: string; invitedAt?: string }>(invitations: T[], dismissed: string[]): T | null {
  const fresh = invitations.filter((invitation) => !dismissed.includes(invitation.id));
  fresh.sort((a, b) => new Date(b.invitedAt ?? 0).getTime() - new Date(a.invitedAt ?? 0).getTime());
  return fresh[0] ?? null;
}

/** Days until `iso`, rounded up, never negative. */
export function daysUntil(iso: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86_400_000));
}

interface InvitationPromptState {
  openId: string | null;
  open: (id: string) => void;
  close: () => void;
}

export const useInvitationPrompt = create<InvitationPromptState>((set) => ({
  openId: null,
  open: (openId) => set({ openId }),
  close: () => set({ openId: null }),
}));
