import { Rect, Text, Group } from "react-konva";

interface CompareSliderNodeProps {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function CompareSliderNode({ x, y, width, height }: CompareSliderNodeProps) {
  return (
    <Group x={x} y={y}>
      <Rect width={width} height={height} fill="#1a1a1a" stroke="#333" />
      <Text text="Compare Slider Node" fill="#888" padding={8} />
    </Group>
  );
}
