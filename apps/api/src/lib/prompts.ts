const STRUCTURE_LOCK_PREFIX =
  "Preserve the original structure and geometry exactly. Do not add, remove, or move walls, " +
  "windows, doors, or any structural elements. Only change materials, lighting, and context.";

export function buildRenderPrompt(instruction: string): string {
  return `${STRUCTURE_LOCK_PREFIX} ${instruction}`.trim();
}
