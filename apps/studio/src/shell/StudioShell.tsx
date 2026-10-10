import { useEffect, useRef, useState } from "react";
import type { Project } from "@renvia/types";
import { Link } from "react-router-dom";
import { ApiError, useApiClient } from "../lib/apiClient";
import { recordRecentlyViewed } from "../lib/localCollections";
import { useCanvasStore } from "../canvas/hooks/useCanvasStore";
import { canvasNodeFromRecord, focusViewNode, nodeToPersistedData } from "../canvas/utils/placeImageNode";
import { useRenderJobsStore } from "../canvas/hooks/useRenderJobsStore";
import { CanvasStage } from "../canvas/CanvasStage";
import { RenderPreview } from "../canvas/RenderPreview";
import { ImagePreview } from "../canvas/ImagePreview";
import { DownloadDialog } from "../canvas/DownloadDialog";
import { IconRail } from "./IconRail";
import { ControlPanel } from "./ControlPanel";
import { CanvasTopBar } from "./CanvasTopBar";
import { StudioNotice } from "./StudioNotice";
import { RenderResultsPanel } from "./panel/RenderResultsPanel";
import { AddViewMenu } from "./panel/AddViewMenu";
import { GuideProvider } from "../guide/GuideProvider";
import { useElevationUpload } from "../canvas/hooks/useElevationUpload";
import { nodeForView, tabLabel, type BuildingView } from "../canvas/buildingViews";
import { reportClientError } from "../components/AppErrorHandling";
import { RegionBoundary } from "../components/RegionBoundary";

export function StudioShell({ projectId }: { projectId: string }) {
  const apiClient = useApiClient();
  const [project, setProject] = useState<Project | null>(null);
  const views = useCanvasStore((state) => state.views);
  const nodes = useCanvasStore((state) => state.nodes);
  const activeViewId = useCanvasStore((state) => state.activeViewId);
  const skippedViewIds = useCanvasStore((state) => state.skippedViewIds);
  const setProjectId = useCanvasStore((state) => state.setProjectId);
  const setNodes = useCanvasStore((state) => state.setNodes);
  const selectView = useCanvasStore((state) => state.selectView);
  const setJobs = useRenderJobsStore((state) => state.setJobs);
  const { uploadToView } = useElevationUpload();
  const filmstripInputRef = useRef<HTMLInputElement>(null);
  const pendingViewRef = useRef<BuildingView | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fail = (message: string) => () => {
      if (!cancelled) setLoadError((current) => current ?? message);
    };

    setProjectId(projectId);
    useRenderJobsStore.setState({ jobs: [], activeJobId: null, previewJobId: null, previewImage: null });
    setProject(null);
    setLoadError(null);
    apiClient.getProject(projectId).then((result) => {
      if (!cancelled) {
        setProject(result);
        recordRecentlyViewed(result.id, result.name);
      }
    }).catch((error: unknown) => {
      fail(error instanceof ApiError && error.status === 404 ? "This project doesn't exist, or it was deleted." : "Couldn't load this project.")();
    });
    apiClient.listCanvasNodes(projectId).then(({ nodes: records }) => {
      if (cancelled) return;
      const incoming = records.map(canvasNodeFromRecord);
      setNodes(incoming);
      const hydrated = useCanvasStore.getState().nodes;
      hydrated.forEach((node, index) => {
        const before = incoming[index];
        if (!before) return;
        if (before.elevationId !== node.elevationId || before.viewKey !== node.viewKey) {
          apiClient.updateCanvasNode(node.id, { data: nodeToPersistedData(node) }).catch((error) => {
            reportClientError(error);
          });
        }
      });
    }).catch(fail("Couldn't load this project's elevations."));
    apiClient.listRenders(projectId).then(({ jobs }) => {
      if (!cancelled) setJobs(jobs);
    }).catch(fail("Couldn't load this project's renders."));

    return () => {
      cancelled = true;
    };
  }, [apiClient, projectId, reloadKey, setJobs, setNodes, setProjectId]);

  const projectName = project ? project.name : loadError ? "Project unavailable" : "Loading…";
  const activeView = views.find((view) => view.id === activeViewId) ?? views[0];
  const activeIndex = Math.max(0, views.findIndex((view) => view.id === activeViewId));
  const pickFile = (view: BuildingView) => {
    pendingViewRef.current = view;
    filmstripInputRef.current?.click();
  };

  return (
    <GuideProvider>
      <div className="studio-shell-v2">
      <IconRail />
      <main className="studio-main">
        <CanvasTopBar projectName={projectName} />
        {loadError ? (
          <div className="studio-load-error" role="alert">
            <h2>{loadError}</h2>
            <p>Check your connection and try again, or go back to your projects.</p>
            <div>
              <button type="button" onClick={() => setReloadKey((key) => key + 1)}>Try again</button>
              <Link to="/dashboard">Back to projects</Link>
            </div>
          </div>
        ) : (
        <div className="studio-workbench">
          <RegionBoundary name="The control panel">
            <ControlPanel projectId={projectId} />
          </RegionBoundary>
          <section className="studio-canvas-column">
            <div className="elevation-tabs" data-guide="canvas.tabs">
              {views.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  className={view.id === activeViewId ? "active" : ""}
                  onClick={() => {
                    selectView(view.id);
                    focusViewNode(view.id);
                  }}
                >
                  {tabLabel(view)}
                </button>
              ))}
              <AddViewMenu />
            </div>
            <div className="studio-stage-wrap" data-guide="canvas.stage" data-view-label={`${activeIndex + 1}   ${activeView ? tabLabel(activeView) : "Front Elevation"}`}>
              <RegionBoundary name="The canvas">
                <CanvasStage />
                <RenderPreview />
                <ImagePreview />
              </RegionBoundary>
              <StudioNotice />
            </div>
            <div className="elevation-filmstrip" data-guide="canvas.filmstrip">
              {views.map((view, index) => {
                const node = nodeForView(nodes, view.id);
                const skipped = Boolean(node) && skippedViewIds.includes(view.id);
                return (
                  <button
                    key={view.id}
                    type="button"
                    className={`${view.id === activeViewId ? "active" : ""} ${node ? "is-filled" : "is-empty"} ${skipped ? "is-skipped" : ""}`}
                    title={skipped ? `${view.label} — skipped on Generate` : undefined}
                    onClick={() => {
                      selectView(view.id);
                      focusViewNode(view.id);
                      if (!node) pickFile(view);
                    }}
                  >
                    <span className="filmstrip-thumb">
                      {node ? (
                        <img src={node.imageUrl} alt="" draggable={false} />
                      ) : (
                        <b>
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V5M7.5 9.5 12 5l4.5 4.5M5 19h14" /></svg>
                          Upload
                        </b>
                      )}
                      {skipped && <em>Skipped</em>}
                    </span>
                    <small>
                      <i>{index + 1}</i>
                      <span>{tabLabel(view)}</span>
                    </small>
                  </button>
                );
              })}
              <AddViewMenu compact />
            </div>
            <input
              ref={filmstripInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                const view = pendingViewRef.current;
                event.target.value = "";
                pendingViewRef.current = null;
                if (file && view) void uploadToView(view, file);
              }}
            />
          </section>
          <RegionBoundary name="The results panel">
            <RenderResultsPanel />
          </RegionBoundary>
        </div>
        )}
      </main>
      <RegionBoundary name="The download dialog" silent>
        <DownloadDialog />
      </RegionBoundary>
      </div>
    </GuideProvider>
  );
}
