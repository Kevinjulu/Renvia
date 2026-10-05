import { useEffect } from "react";
import { create } from "zustand";

const DISMISS_MS = 7000;

interface StudioNoticeState {
  message: string | null;
  /** Bumped on every show, so repeating the same message restarts the dismiss timer. */
  id: number;
  show: (message: string) => void;
  dismiss: () => void;
}

/** One transient, non-blocking error line over the canvas — for failures that would otherwise only be logged. */
export const useStudioNoticeStore = create<StudioNoticeState>((set) => ({
  message: null,
  id: 0,
  show: (message) => set((state) => ({ message, id: state.id + 1 })),
  dismiss: () => set({ message: null }),
}));

export function showStudioNotice(message: string) {
  useStudioNoticeStore.getState().show(message);
}

export function StudioNotice() {
  const message = useStudioNoticeStore((state) => state.message);
  const id = useStudioNoticeStore((state) => state.id);
  const dismiss = useStudioNoticeStore((state) => state.dismiss);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(dismiss, DISMISS_MS);
    return () => clearTimeout(timer);
  }, [message, id, dismiss]);

  if (!message) return null;
  return (
    <div className="studio-notice" role="alert">
      <span>{message}</span>
      <button type="button" onClick={dismiss} aria-label="Dismiss">×</button>
    </div>
  );
}
