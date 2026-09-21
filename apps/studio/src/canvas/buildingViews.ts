export type BuildingViewKey = "front" | "right" | "back" | "left" | "extra";

export interface BuildingView {
  id: string;
  key: BuildingViewKey;
  label: string;
}

export interface ViewBoundNode {
  id: string;
  imageUrl: string;
  elevationId?: string;
  viewKey?: BuildingViewKey;
  viewLabel?: string;
}

export const DEFAULT_BUILDING_VIEWS: BuildingView[] = [
  { id: "front", key: "front", label: "Front Elevation" },
  { id: "right", key: "right", label: "Right Elevation" },
  { id: "back", key: "back", label: "Back Elevation" },
  { id: "left", key: "left", label: "Left Elevation" },
];

export const EXTRA_VIEW_PRESETS = ["Roof", "Isometric", "Site plan"] as const;

export function createDefaultBuildingViews(): BuildingView[] {
  return DEFAULT_BUILDING_VIEWS.map((view) => ({ ...view }));
}

export function isDefaultViewId(id: string): boolean {
  return DEFAULT_BUILDING_VIEWS.some((view) => view.id === id);
}

export function tabLabel(view: BuildingView): string {
  return view.label;
}

export function nodeForView<T extends ViewBoundNode>(nodes: T[], viewId: string): T | undefined {
  return nodes.find((node) => node.elevationId === viewId && Boolean(node.imageUrl));
}

export function filledBuildingViews<T extends ViewBoundNode>(views: BuildingView[], nodes: T[]): BuildingView[] {
  return views.filter((view) => Boolean(nodeForView(nodes, view.id)));
}

export function hydrateBuildingViews<T extends ViewBoundNode>(nodes: T[]): { views: BuildingView[]; nodes: T[] } {
  const views = createDefaultBuildingViews();
  const occupied = new Set<string>();
  const next = nodes.map((node) => ({ ...node }));

  const bind = (node: T, view: BuildingView) => {
    node.elevationId = view.id;
    node.viewKey = view.key;
    node.viewLabel = view.label;
    occupied.add(view.id);
  };

  for (const node of next) {
    const match = views.find((view) => view.id === node.elevationId);
    if (match && !occupied.has(match.id)) {
      bind(node, match);
    }
  }

  for (const node of next) {
    if (!node.elevationId || occupied.has(node.elevationId)) continue;
    if (views.some((view) => view.id === node.elevationId)) continue;
    const extra: BuildingView = {
      id: node.elevationId,
      key: "extra",
      label: node.viewLabel?.trim() || "Custom elevation",
    };
    views.push(extra);
    bind(node, extra);
  }

  for (const node of next) {
    if (node.elevationId && occupied.has(node.elevationId)) continue;
    const emptyDefault = views.find((view) => view.key !== "extra" && !occupied.has(view.id));
    if (emptyDefault) {
      bind(node, emptyDefault);
      continue;
    }
    const extra: BuildingView = {
      id: node.id,
      key: "extra",
      label: node.viewLabel?.trim() || "Custom elevation",
    };
    views.push(extra);
    bind(node, extra);
  }

  return { views, nodes: next };
}
