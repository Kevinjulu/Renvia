import type { PanelTab } from "../../canvas/hooks/useCanvasStore";

export type { PanelTab };

interface RenderEditTabsProps {
  active: PanelTab;
  onChange: (tab: PanelTab) => void;
}

export function RenderEditTabs({ active, onChange }: RenderEditTabsProps) {
  return (
    <div className="flex border-b border-hairline">
      <button
        type="button"
        onClick={() => onChange("render")}
        className={`flex items-center gap-1.5 border-b-2 px-1 pb-2 text-sm font-medium transition-colors ${
          active === "render" ? "border-blueprint text-blueprint" : "border-transparent text-secondary hover:text-primary"
        }`}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <path d="M6.5 1.2 7.6 4.4 10.8 5.5 7.6 6.6 6.5 9.8 5.4 6.6 2.2 5.5 5.4 4.4Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
        </svg>
        Render
      </button>
      <button
        type="button"
        onClick={() => onChange("edit")}
        className={`ml-5 flex items-center gap-1.5 border-b-2 px-1 pb-2 text-sm font-medium transition-colors ${
          active === "edit" ? "border-blueprint text-blueprint" : "border-transparent text-secondary hover:text-primary"
        }`}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <path d="M8.5 1.5 11 4 4.5 10.5 2 11l.5-2.5Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
        </svg>
        Edit
      </button>
    </div>
  );
}
