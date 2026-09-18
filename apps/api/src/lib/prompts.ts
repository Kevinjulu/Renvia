const STRUCTURE_LOCK_PREFIX =
  "Preserve the original structure and geometry exactly. Do not add, remove, or move walls, " +
  "windows, doors, or any structural elements. Only change materials, lighting, and context.";

export function buildRenderPrompt(
  instruction: string,
  options?: { preserveStructure?: boolean },
): string {
  const preserve = options?.preserveStructure !== false;
  if (!preserve) return instruction.trim();
  return `${STRUCTURE_LOCK_PREFIX} ${instruction}`.trim();
}
