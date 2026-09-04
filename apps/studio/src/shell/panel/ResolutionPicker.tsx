const TIERS = [
  { label: "1K", locked: false },
  { label: "2K", locked: true },
  { label: "4K", locked: true },
] as const;

interface ResolutionPickerProps {
  value: string;
  onChange: (tier: string) => void;
}

export function ResolutionPicker({ value, onChange }: ResolutionPickerProps) {
  return (
    <div>
      <p className="text-sm font-medium text-primary">Resolution</p>
      <div className="mt-2 flex gap-1 rounded-lg bg-surface-muted p-1">
        {TIERS.map((tier) => {
          const isActive = value === tier.label;
          return (
            <button
              key={tier.label}
              type="button"
              disabled={tier.locked}
              onClick={() => onChange(tier.label)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition-all ${
                isActive
                  ? "bg-white text-primary shadow-sm"
                  : tier.locked
                    ? "cursor-not-allowed text-faint"
                    : "text-secondary hover:text-primary"
              }`}
            >
              {tier.label}
              {tier.locked && (
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true" className="text-faint">
                  <rect x="2" y="4.5" width="6" height="4.5" rx="0.8" fill="currentColor" />
                  <path d="M3.2 4.5V3a1.8 1.8 0 0 1 3.6 0v1.5" stroke="currentColor" strokeWidth="1" fill="none" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
