import { useEffect, useState } from "react";
import type { Project } from "@renvia/types";
import { useApiClient } from "../lib/apiClient";
import { recordRecentlyViewed } from "../lib/localCollections";
import { useCanvasStore } from "../canvas/hooks/useCanvasStore";
import { canvasNodeFromRecord } from "../canvas/utils/placeImageNode";
import { useRenderJobsStore } from "../canvas/hooks/useRenderJobsStore";
import { CanvasStage } from "../canvas/CanvasStage";
import { IconRail } from "./IconRail";
import { ControlPanel } from "./ControlPanel";
import { CanvasTopBar } from "./CanvasTopBar";
import { RenderResultsPanel } from "./panel/RenderResultsPanel";

export function StudioShell({ projectId }: { projectId: string }) {
  const apiClient = useApiClient();
  const [project, setProject] = useState<Project | null>(null);
  const nodes = useCanvasStore((state) => state.nodes);
  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId);
  const setProjectId = useCanvasStore((state) => state.setProjectId);
  const setNodes = useCanvasStore((state) => state.setNodes);
  const setJobs = useRenderJobsStore((state) => state.setJobs);

  useEffect(() => {
    let cancelled = false;

    setProjectId(projectId);
    apiClient.getProject(projectId).then((result) => {
      if (!cancelled) {
        setProject(result);
        recordRecentlyViewed(result.id, result.name);
      }
    });
    apiClient.listCanvasNodes(projectId).then(({ nodes: records }) => {
      if (!cancelled) setNodes(records.map(canvasNodeFromRecord));
    });
    apiClient.listRenders(projectId).then(({ jobs }) => {
      if (!cancelled) setJobs(jobs);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const currentNode = nodes.find((node) => node.id === selectedNodeId) ?? nodes[0] ?? null;

  return (
    <div className="flex h-screen w-full">
      <IconRail />
      <ControlPanel
        projectId={projectId}
        projectName={project ? project.name : "Loading…"}
        currentImageUrl={currentNode?.imageUrl ?? null}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <CanvasTopBar />
        <div className="min-h-0 flex-1 overflow-hidden">
          <CanvasStage />
        </div>
      </div>
      <RenderResultsPanel />
    </div>
  );
}
