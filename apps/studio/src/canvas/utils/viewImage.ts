import { useRenderJobsStore } from "../hooks/useRenderJobsStore";

/**
 * Opens any image in the studio full-size on the canvas. Use it for images that aren't a
 * render job — sources, references, uploaded views — so every thumbnail is clickable.
 */
export function viewImage(url: string | null | undefined, title: string, caption?: string) {
  if (!url) return;
  useRenderJobsStore.getState().setPreviewImage({ url, title, caption });
}
