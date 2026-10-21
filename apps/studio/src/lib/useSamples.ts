import { useEffect } from "react";
import { create } from "zustand";
import { isDesignCategory, type ListStockReferencesResponse, type StockReference } from "@renvia/types";
import { useApiClient } from "./apiClient";

/** The sample links are signed and expire, so a list older than this is fetched again. */
const MAX_AGE_MS = 30 * 60_000;

type Status = "idle" | "loading" | "ready" | "error";

interface SamplesState {
  samples: StockReference[];
  status: Status;
  loadedAt: number;
  load: (fetchSamples: () => Promise<ListStockReferencesResponse>, force?: boolean) => Promise<void>;
}

/** The team's sample images, shared by everything in the Studio that offers them. */
export const useSamplesStore = create<SamplesState>((set, get) => ({
  samples: [],
  status: "idle",
  loadedAt: 0,
  load: async (fetchSamples, force = false) => {
    const { status, loadedAt } = get();
    if (status === "loading") return;
    if (!force && status === "ready" && Date.now() - loadedAt < MAX_AGE_MS) return;
    set({ status: "loading" });
    try {
      const { references } = await fetchSamples();
      set({ samples: references, status: "ready", loadedAt: Date.now() });
    } catch {
      // Keep whatever was shown before; the next open tries again.
      set({ status: "error" });
    }
  },
}));

/** Loads the samples once per session (and again when stale) and returns them. */
export function useSamples() {
  const apiClient = useApiClient();
  const samples = useSamplesStore((state) => state.samples);
  const status = useSamplesStore((state) => state.status);

  useEffect(() => {
    void useSamplesStore.getState().load(apiClient.listStockReferences);
  }, [apiClient]);

  return {
    samples,
    status,
    designs: samples.filter((sample) => isDesignCategory(sample.category)),
    references: samples.filter((sample) => !isDesignCategory(sample.category)),
    retry: () => useSamplesStore.getState().load(apiClient.listStockReferences, true),
  };
}
