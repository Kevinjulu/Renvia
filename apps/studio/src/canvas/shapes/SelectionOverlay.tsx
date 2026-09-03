import type { ReactElement } from "react";
import { Circle, Line, Rect } from "react-konva";
import type { SelectionShape } from "../hooks/useSelectionToolStore";

interface SelectionOverlayProps {
  /** Top-left of the node the committed selection is anchored to, in world coordinates. */
  targetOrigin: { x: number; y: number } | null;
  selection: SelectionShape | null;
  draftRect: { x: number; y: number; width: number; height: number } | null;
  draftPolygon: number[];
  draftCursor: { x: number; y: number } | null;
}

const STROKE = "#2F6FED";
const FILL = "rgba(47, 111, 237, 0.08)";
const DASH = [6, 4];

export function SelectionOverlay({
  targetOrigin,
  selection,
  draftRect,
  draftPolygon,
  draftCursor,
}: SelectionOverlayProps) {
  const polygonPreviewPoints = draftCursor ? [...draftPolygon, draftCursor.x, draftCursor.y] : draftPolygon;

  return (
    <>
      {selection && targetOrigin && selection.type === "rectangle" && (
        <Rect
          x={targetOrigin.x + selection.x}
          y={targetOrigin.y + selection.y}
          width={selection.width}
          height={selection.height}
          stroke={STROKE}
          dash={DASH}
          strokeWidth={1.5}
          fill={FILL}
          listening={false}
        />
      )}
      {selection && targetOrigin && selection.type === "polygon" && (
        <Line
          points={selection.points.map((value, index) =>
            index % 2 === 0 ? value + targetOrigin.x : value + targetOrigin.y,
          )}
          closed
          stroke={STROKE}
          dash={DASH}
          strokeWidth={1.5}
          fill={FILL}
          listening={false}
        />
      )}

      {draftRect && (
        <Rect
          x={draftRect.x}
          y={draftRect.y}
          width={draftRect.width}
          height={draftRect.height}
          stroke={STROKE}
          dash={DASH}
          strokeWidth={1.5}
          listening={false}
        />
      )}

      {draftPolygon.length >= 2 && (
        <Line points={polygonPreviewPoints} stroke={STROKE} dash={DASH} strokeWidth={1.5} listening={false} />
      )}
      {draftPolygon.reduce<ReactElement[]>((circles, _value, index) => {
        if (index % 2 === 0) {
          circles.push(
            <Circle
              key={index}
              x={draftPolygon[index]}
              y={draftPolygon[index + 1]}
              radius={4}
              fill="white"
              stroke={STROKE}
              strokeWidth={1.5}
              listening={false}
            />,
          );
        }
        return circles;
      }, [])}
    </>
  );
}
