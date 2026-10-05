import { BillingStatus } from "../components/BillingStatus";
import { AccountMenu } from "../components/account/AccountMenu";
import { useCanvasStore } from "../canvas/hooks/useCanvasStore";
import { nodeForView } from "../canvas/buildingViews";

export function CanvasTopBar({ projectName }: { projectName: string }) {
  const scale = useCanvasStore((state) => state.camera.scale);
  const viewCount = useCanvasStore((state) => state.views.length);
  const uploadedCount = useCanvasStore((state) => state.views.filter((view) => nodeForView(state.nodes, view.id)).length);
  const resetZoom = () => {
    const { camera, setCamera } = useCanvasStore.getState();
    setCamera({ ...camera, scale: 1 });
  };
  return <header className="studio-topbar">
    <div className="studio-project-title"><p><strong>{projectName}</strong><span>{uploadedCount} of {viewCount} elevations uploaded</span></p></div>
    <div className="studio-header-actions"><button className="zoom" type="button" aria-label={`Zoom ${Math.round(scale * 100)}%. Reset to 100%`} title="Reset zoom" onClick={resetZoom}>{Math.round(scale * 100)}%</button><BillingStatus /><AccountMenu /></div>
  </header>;
}
