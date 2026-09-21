/**
 * "auto" (match the source) is the unremarkable default, so it's left out of tag lists —
 * only a deliberately fixed ratio is worth surfacing. Returns null for "auto".
 */
export function formatAspectRatio(value: string): string | null {
  return value && value !== "auto" ? value : null;
}
