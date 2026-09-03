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
      <div className="mt-2 flex gap-2">
        {TIERS.map((tier) => {
          const isActive = value === tier.label;
          return (
            <button
              key={tier.label}
              type="button"
              disabled={tier.locked}
              onClick={() => onChange(tier.label)}
              className={`relative flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "border-blueprint text-blueprint"
                  : tier.locked
                    ? "cursor-not-allowed border-hairline text-faint"
                    : "border-hairline text-primary hover:border-hairline-strong"
              }`}
            >
              {tier.label}
              {tier.locked && (
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  aria-hidden="true"
                  className="absolute -right-1 -top-1 rounded-full bg-blueprint p-0.5 text-white"
                >
                  <rect x="2" y="4.5" width="6" height="4.5" rx="0.8" fill="currentColor" />
                  <path d="M3.2 4.5V3a1.8 1.8 0 0 1 3.6 0v1.5" stroke="currentColor" strokeWidth="1" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
