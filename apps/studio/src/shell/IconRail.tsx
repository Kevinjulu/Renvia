import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApiClient } from "../lib/apiClient";

interface RailItem {
  label: string;
  icon: JSX.Element;
  active?: boolean;
  disabled?: boolean;
}

const ICON_PROPS = { width: 18, height: 18, viewBox: "0 0 18 18", fill: "none" as const, "aria-hidden": true };

const TOP_ITEMS: RailItem[] = [
  {
    label: "3D",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M9 2 15.5 5.5v7L9 16l-6.5-3.5v-7Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    ),
    disabled: true,
  },
  {
    label: "Views",
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="2.5" y="4" width="13" height="10" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
        <path d="M2.5 7.5h13" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    ),
    disabled: true,
  },
  {
    label: "Create",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M9 2.5 10.4 6.6 14.5 8 10.4 9.4 9 13.5 7.6 9.4 3.5 8l4.1-1.4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    ),
    active: true,
  },
  {
    label: "Videos",
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="2.5" y="4.5" width="10" height="9" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
        <path d="M12.5 8 16 6v6l-3.5-2Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    ),
    disabled: true,
  },
];

const BOTTOM_ITEMS: RailItem[] = [
  {
    label: "Learn",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M2.5 4.5h5a2 2 0 0 1 2 2v8a1.5 1.5 0 0 0-1.5-1.5h-5.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M15.5 4.5h-5a2 2 0 0 0-2 2v8a1.5 1.5 0 0 1 1.5-1.5h5.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    ),
    disabled: true,
  },
  {
    label: "Support",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M9 11.5v.01M9 9.2c0-1.4 1.6-1.3 1.6-2.7C10.6 5.5 9.8 5 9 5s-1.6.5-1.6 1.7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
    disabled: true,
  },
];

function RailButton({ item }: { item: RailItem }) {
  return (
    <button
      type="button"
      title={item.disabled ? `${item.label} (coming soon)` : item.label}
      disabled={item.disabled}
      className={`group relative flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] font-medium transition-all ${
        item.active
          ? "bg-primary text-white shadow-sm"
          : item.disabled
            ? "cursor-default text-faint/50"
            : "text-secondary hover:-translate-y-px hover:bg-surface-muted hover:text-primary"
      }`}
    >
      {item.icon}
      {item.label}
    </button>
  );
}

export function IconRail() {
  const navigate = useNavigate();
  const apiClient = useApiClient();
  const [isCreating, setIsCreating] = useState(false);

  const handleNewProject = async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const project = await apiClient.createProject({ name: "Untitled project" });
      navigate(`/project/${project.id}`);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="flex h-full w-16 shrink-0 flex-col items-center justify-between border-r border-hairline bg-white py-4">
      <div className="flex flex-col items-center gap-4">
        <Link
          to="/dashboard"
          title="Back to dashboard"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-white transition-transform hover:scale-105 active:scale-95"
        >
          R
        </Link>
        <div className="flex flex-col gap-1">
          {TOP_ITEMS.map((item) => (
            <RailButton key={item.label} item={item} />
          ))}
        </div>
      </div>

      <div className="flex flex-col items-center gap-4">
        <button
          type="button"
          title="New project"
          onClick={() => void handleNewProject()}
          disabled={isCreating}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-hairline-strong text-secondary transition-all hover:border-blueprint hover:bg-blueprint-soft hover:text-blueprint disabled:cursor-wait disabled:opacity-60"
        >
          {isCreating ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
        </button>

        <div className="h-px w-8 bg-hairline" />

        <div className="flex flex-col gap-1">
          {BOTTOM_ITEMS.map((item) => (
            <RailButton key={item.label} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}
