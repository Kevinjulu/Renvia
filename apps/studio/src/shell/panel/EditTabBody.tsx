import { useState } from "react";
import { useSelectionToolStore, type SelectionShape } from "../../canvas/hooks/useSelectionToolStore";

function selectionLabel(selection: SelectionShape | null): string {
  if (!selection) return "No area selected";
  if (selection.type === "rectangle") return "Rectangle area selected";
  return `Polygon area selected (${selection.points.length / 2} points)`;
}

export function EditTabBody() {
  const selection = useSelectionToolStore((state) => state.selection);
  const activeTool = useSelectionToolStore((state) => state.activeTool);
  const clearSelection = useSelectionToolStore((state) => state.clearSelection);
  const [editPrompt, setEditPrompt] = useState("");

  return (
    <div className="flex flex-1 flex-col">
      <p className="text-sm text-secondary">
        Use Rectangle select or Polygon select above the canvas to mark the exact area you want to change, then
        describe the edit below.
      </p>

      <div className="mt-3 flex items-center justify-between rounded-lg border border-hairline bg-surface-muted px-3 py-2">
        <span className="text-sm text-primary">
          {activeTool ? "Drawing… click to place points" : selectionLabel(selection)}
        </span>
        {selection && (
          <button type="button" onClick={clearSelection} className="text-xs font-medium text-blueprint hover:underline">
            Clear
          </button>
        )}
      </div>

      <textarea
        value={editPrompt}
        onChange={(event) => setEditPrompt(event.target.value)}
        placeholder="Example: Change this wall to brown Decra roof tiles"
        disabled={!selection}
        className="mt-3 min-h-[120px] flex-1 resize-none rounded-lg border border-hairline p-3 text-sm text-primary placeholder:text-faint focus:border-blueprint focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-faint"
      />

      <button
        type="button"
        disabled
        title="Regional editing is coming soon"
        className="mt-3 w-full cursor-not-allowed rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white opacity-40"
      >
        Apply edit (coming soon)
      </button>
    </div>
  );
}
