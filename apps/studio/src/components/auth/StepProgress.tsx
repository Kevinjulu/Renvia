import type { AuthAccent } from "./BlueprintPanel";

interface StepProgressProps {
  steps: string[];
  currentIndex: number;
  accent?: AuthAccent;
}

const ACCENT_BAR = {
  blueprint: "bg-blueprint",
  glow: "bg-glow",
} as const;

export function StepProgress({ steps, currentIndex, accent = "blueprint" }: StepProgressProps) {
  return (
    <div className="mb-6 flex flex-col gap-2">
      <div className="flex gap-1.5">
        {steps.map((step, index) => (
          <span
            key={step}
            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
              index <= currentIndex ? ACCENT_BAR[accent] : "bg-hairline"
            }`}
          />
        ))}
      </div>
      <span className="font-mono text-xs uppercase tracking-wide text-faint">
        Step {String(currentIndex + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")} — {steps[currentIndex]}
      </span>
    </div>
  );
}
