import { Group, Image as KonvaImage, Rect } from "react-konva";
import useImage from "use-image";

interface ImageNodeProps {
  x: number;
  y: number;
  width: number;
  height: number;
  imageUrl: string;
  selected?: boolean;
  draggable?: boolean;
  onSelect?: () => void;
  onDragEnd?: (x: number, y: number) => void;
}

export function ImageNode({
  x,
  y,
  width,
  height,
  imageUrl,
  selected = false,
  draggable = true,
  onSelect,
  onDragEnd,
}: ImageNodeProps) {
  const [image] = useImage(imageUrl, "anonymous");

  return (
    <Group
      x={x}
      y={y}
      draggable={draggable}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(event) => onDragEnd?.(event.target.x(), event.target.y())}
    >
      {image ? (
        <KonvaImage image={image} width={width} height={height} cornerRadius={8} />
      ) : (
        <Rect width={width} height={height} fill="#F5F5F3" stroke="#E7E4DD" cornerRadius={8} />
      )}
      {selected && (
        <Rect
          width={width}
          height={height}
          stroke="#2F6FED"
          strokeWidth={2}
          cornerRadius={8}
          listening={false}
        />
      )}
    </Group>
  );
}
