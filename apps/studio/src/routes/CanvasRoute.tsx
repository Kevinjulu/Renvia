import { useParams } from "react-router-dom";
import { StudioShell } from "../shell/StudioShell";

export function CanvasRoute() {
  const { projectId } = useParams<{ projectId: string }>();

  if (!projectId) return null;

  return <StudioShell projectId={projectId} />;
}
