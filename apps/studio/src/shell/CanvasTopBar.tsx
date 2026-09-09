import { BillingStatus } from "../components/BillingStatus";
import { AccountMenu } from "../components/account/AccountMenu";
import { useCanvasStore } from "../canvas/hooks/useCanvasStore";

export function CanvasTopBar({ projectName }: { projectName: string }) {
  const camera = useCanvasStore((state) => state.camera);
  const setCamera = useCanvasStore((state) => state.setCamera);
  return <header className="studio-topbar">
    <div className="studio-project-title"><button type="button" aria-label="Fit project">⌗</button><p><strong>{projectName}</strong><span>Draft&nbsp; • &nbsp;4 views&nbsp; • &nbsp;Saved just now</span></p><button type="button" aria-label="Rename project">⌁</button></div>
    <div className="studio-mode-switch"><button className="active" type="button">Canvas</button><button type="button">Gallery</button><button type="button">Compare</button></div>
    <div className="studio-header-actions"><button type="button" title="Undo">↶</button><button type="button" title="Redo">↷</button><button className="zoom" type="button" onClick={() => setCamera({ ...camera, scale: 1 })}>{Math.round(camera.scale * 100)}%⌄</button><button type="button" title="Fit to screen">⛶</button><BillingStatus /><AccountMenu /></div>
  </header>;
}
