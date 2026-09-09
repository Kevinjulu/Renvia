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

  const projectName = project ? project.name : "Loading…";
  const elevationNames = ["Front View", "Right View", "Back View", "Left View"];

  return (
    <div className="studio-shell-v2">
      <IconRail />
      <main className="studio-main">
        <CanvasTopBar projectName={projectName} />
        <div className="studio-workbench">
          <ControlPanel projectId={projectId} projectName={projectName} currentImageUrl={currentNode?.imageUrl ?? null} />
          <section className="studio-canvas-column">
            <div className="elevation-tabs">
              {elevationNames.map((name, index) => <button key={name} type="button" className={index === 0 ? "active" : ""}>{name}</button>)}
              <button type="button">＋ Add view</button>
            </div>
            <div className="studio-stage-wrap"><CanvasStage /></div>
            <div className="elevation-filmstrip">
              {elevationNames.map((name, index) => {
                const node = nodes[index] ?? nodes[0];
                return <button key={name} type="button" className={index === 0 ? "active" : ""} onClick={() => node && useCanvasStore.getState().selectNode(node.id)}><span>{node ? <img src={node.imageUrl} alt="" /> : <b>＋</b>}</span><small><i>{index + 1}</i>{name}</small></button>;
              })}
              <button type="button" className="add-view"><span>＋</span><small>Add view</small></button>
            </div>
          </section>
          <RenderResultsPanel />
        </div>
      </main>
    </div>
  );
}
