export function buildMaterialEditPrompt(instruction: string): string {
  return `Preserve the original structure and geometry exactly. Only change materials, lighting, and context. ${instruction}`;
}
