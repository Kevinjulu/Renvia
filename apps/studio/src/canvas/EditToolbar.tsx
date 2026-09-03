import type { ReactNode } from "react";
import { useSelectionToolStore, type SelectionTool } from "./hooks/useSelectionToolStore";

function RectangleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="10" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.2 2" />
    </svg>
  );
}

function PolygonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M4 2.5 11.5 5 9.5 11.5 2.5 9Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <circle cx="4" cy="2.5" r="1.1" fill="white" stroke="currentColor" strokeWidth="1" />
      <circle cx="11.5" cy="5" r="1.1" fill="white" stroke="currentColor" strokeWidth="1" />
      <circle cx="9.5" cy="11.5" r="1.1" fill="white" stroke="currentColor" strokeWidth="1" />
      <circle cx="2.5" cy="9" r="1.1" fill="white" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function TreeViewIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="2.5" cy="3" r="1.3" stroke="currentColor" strokeWidth="1.1" />
      <path d="M2.5 4.3v3.2a1 1 0 0 0 1 1h1.5M2.5 4.3v5.4a1 1 0 0 0 1 1h1.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <rect x="7" y="1.8" width="5.5" height="2.4" rx="0.7" stroke="currentColor" strokeWidth="1" />
      <rect x="7" y="6.4" width="5.5" height="2.4" rx="0.7" stroke="currentColor" strokeWidth="1" />
      <rect x="7" y="9.8" width="5.5" height="2.4" rx="0.7" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

interface ToolButtonProps {
  icon: ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

function ToolButton({ icon, label, active, disabled, onClick }: ToolButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? `${label} (coming soon)` : label}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm transition-colors ${
        active
          ? "bg-blueprint-soft text-blueprint"
          : disabled
            ? "cursor-not-allowed text-faint"
            : "text-secondary hover:bg-surface-muted hover:text-primary"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

export function EditToolbar() {
  const activeTool = useSelectionToolStore((state) => state.activeTool);
  const setActiveTool = useSelectionToolStore((state) => state.setActiveTool);
  const selection = useSelectionToolStore((state) => state.selection);
  const clearSelection = useSelectionToolStore((state) => state.clearSelection);

  const toggleTool = (tool: SelectionTool) => {
    setActiveTool(activeTool === tool ? null : tool);
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-hairline bg-white px-1.5 py-1 shadow-lg">
        <ToolButton
          icon={<RectangleIcon />}
          label="Rectangle select"
          active={activeTool === "rectangle"}
          onClick={() => toggleTool("rectangle")}
        />
        <ToolButton
          icon={<PolygonIcon />}
          label="Polygon select"
          active={activeTool === "polygon"}
          onClick={() => toggleTool("polygon")}
        />
        <ToolButton icon={<TreeViewIcon />} label="Tree view" disabled />
        {selection && (
          <>
            <span className="mx-0.5 h-4 w-px bg-hairline" aria-hidden="true" />
            <ToolButton icon={null} label="Clear" onClick={clearSelection} />
          </>
        )}
      </div>
    </div>
  );
}
