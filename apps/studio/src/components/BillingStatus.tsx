interface BillingStatusProps {
  credits?: number;
}

/** Credits pill + Upgrade button — shared between the dashboard and canvas top bars. */
export function BillingStatus({ credits = 0 }: BillingStatusProps) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-1.5 text-sm text-secondary">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true" className="text-blueprint">
          <path d="M6.5 1.2 7.6 4.4 10.8 5.5 7.6 6.6 6.5 9.8 5.4 6.6 2.2 5.5 5.4 4.4Z" fill="currentColor" />
        </svg>
        {credits}
      </div>
      <button
        type="button"
        className="group flex items-center gap-1.5 rounded-full bg-primary py-1.5 pl-2.5 pr-3.5 text-sm font-medium text-white transition-all duration-150 hover:opacity-90 active:scale-[0.97]"
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true" className="text-glow transition-transform duration-150 group-hover:scale-110">
          <path d="M6.5 1.2 7.6 4.4 10.8 5.5 7.6 6.6 6.5 9.8 5.4 6.6 2.2 5.5 5.4 4.4Z" fill="currentColor" />
        </svg>
        Upgrade
      </button>
    </div>
  );
}
