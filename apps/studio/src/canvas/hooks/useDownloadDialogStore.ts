import { create } from "zustand";

interface DownloadDialogState {
  /** Render whose download options are open; null when the dialog is closed. */
  jobId: string | null;
  open: (jobId: string) => void;
  close: () => void;
}

export const useDownloadDialogStore = create<DownloadDialogState>((set) => ({
  jobId: null,
  open: (jobId) => set({ jobId }),
  close: () => set({ jobId: null }),
}));
