export type PackOutcome = {
  renders: number | null;
  renderLabel: string;
  guidance: string;
};

export function packOutcome(credits: number, creditsPerImage: number): PackOutcome {
  const guidance = credits <= 50
    ? "Ideal for testing a direction or finishing a focused project."
    : "Built for an active workflow with room to explore options.";
  if (creditsPerImage <= 0) return {
    renders: null,
    renderLabel: "standard renders currently require no credits",
    guidance,
  };
  const renders = Math.max(0, Math.floor(credits / creditsPerImage));
  return {
    renders,
    renderLabel: `${renders} standard ${renders === 1 ? "render" : "renders"}`,
    guidance,
  };
}
