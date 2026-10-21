import { create } from "zustand";
import type { EditNeed } from "@renvia/types";

/** What the Edit panel should point at when Apply edit is pressed without what it needs. */
export type EditNudgeTarget = EditNeed | "render";

interface EditNudgeState {
  target: EditNudgeTarget | null;
  /** Changes on every press, so pressing twice points at it twice. */
  tick: number;
  nudge: (target: EditNudgeTarget) => void;
}

export const useEditNudgeStore = create<EditNudgeState>((set) => ({
  target: null,
  tick: 0,
  nudge: (target) => set((state) => ({ target, tick: state.tick + 1 })),
}));

/** The element id in the Edit panel that answers each need. */
export const EDIT_NUDGE_IDS: Record<EditNeed, string> = {
  prompt: "edit-prompt",
  reference: "edit-references",
  "reference-note": "edit-references",
  area: "edit-scope",
  something: "edit-method",
};
