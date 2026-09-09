/** The dashboard's 16px stroke icon set — one weight (1.2), one grid, so nav, rail and cards read as one family. */

const ICON_PROPS = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none" as const, "aria-hidden": true };

export function HomeIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M2.5 7 8 2.5 13.5 7v6a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M6.3 14V9.5h3.4V14" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function GridIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="2.5" y="2.5" width="4.7" height="4.7" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="8.8" y="2.5" width="4.7" height="4.7" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="2.5" y="8.8" width="4.7" height="4.7" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="8.8" y="8.8" width="4.7" height="4.7" rx="1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function CompassIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="8" cy="8" r="5.7" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10.4 5.6 9.1 9.1 5.6 10.4 6.9 6.9Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function TemplateIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="2.5" y="2.8" width="11" height="10.4" rx="1.4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.5 6.3h11M6.6 6.3v6.9" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function LayersIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M8 2.4 14 5.4 8 8.4 2 5.4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="m2 8.6 6 3 6-3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="m2 11.4 6 3 6-3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function SparkleIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M8 2.5 9.1 6 12.5 7 9.1 8l-1.1 3.5L6.9 8 3.5 7l3.4-1Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

export function AiToolsIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M8 2.5 9.1 6 12.5 7 9.1 8l-1.1 3.5L6.9 8 3.5 7l3.4-1Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M12.4 11.2 12.9 12.7 14.4 13.2 12.9 13.7 12.4 15.2 11.9 13.7 10.4 13.2 11.9 12.7Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

export function TeamIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="6.2" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.2 13.3c0-2.2 1.8-3.6 4-3.6s4 1.4 4 3.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M10.9 4.2a2.3 2.3 0 0 1 0 4.1M12.4 13.3c0-1.6-.5-2.7-1.5-3.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function InviteIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="6.2" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.2 13.3c0-2.2 1.8-3.6 4-3.6s4 1.4 4 3.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M12.4 4.6v3.6M14.2 6.4h-3.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function SettingsIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="8" cy="8" r="2.1" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M8 1.9v1.5M8 12.6v1.5M14.1 8h-1.5M3.4 8H1.9M12.3 3.7l-1 1M4.7 11.3l-1 1M12.3 12.3l-1-1M4.7 4.7l-1-1"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="7.2" cy="7.2" r="4.4" stroke="currentColor" strokeWidth="1.2" />
      <path d="m10.6 10.6 3.2 3.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function BellIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 6.3a4 4 0 0 1 8 0v3l1.2 2H2.8l1.2-2Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M6.5 13.2a1.6 1.6 0 0 0 3 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M8 3.2v9.6M3.2 8h9.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function PencilIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M10.6 2.9 13.1 5.4 5.8 12.7 2.9 13.1 3.3 10.2Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function LearnIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M2.3 4h4.3a1.8 1.8 0 0 1 1.8 1.8v7A1.4 1.4 0 0 0 7 11.5H2.3Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M13.7 4H9.4a1.8 1.8 0 0 0-1.8 1.8v7A1.4 1.4 0 0 1 9 11.5h4.7Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

export function PlayIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="8" cy="8" r="5.9" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6.7 5.6 10.3 8l-3.6 2.4Z" fill="currentColor" />
    </svg>
  );
}

export function ClockIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="8" cy="8" r="5.7" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 5v3.3l2.2 1.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function StarIcon({ filled }: { filled?: boolean }) {
  return (
    <svg {...ICON_PROPS} fill={filled ? "currentColor" : "none"}>
      <path d="M8 2.3 9.8 6l4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4L2.2 6.6l4-.6Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

export function GiftIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="2.5" y="6.5" width="11" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.2 6.5h11.6M8 6.5V14" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M8 6.5c0-2-1.2-3-2.3-3-1 0-1.7.7-1.7 1.6 0 1 .8 1.4 1.5 1.4Zm0 0c0-2 1.2-3 2.3-3 1 0 1.7.7 1.7 1.6 0 1-.8 1.4-1.5 1.4Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronRightIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2.5 6h7M6.5 2.5 10 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DisclosureIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
    >
      <path d="M3.5 2 6.5 5l-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The credit mark, shared with BillingStatus and the account menu. */
export function CreditIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M6.5 1.2 7.6 4.4 10.8 5.5 7.6 6.6 6.5 9.8 5.4 6.6 2.2 5.5 5.4 4.4Z" fill="currentColor" />
    </svg>
  );
}
