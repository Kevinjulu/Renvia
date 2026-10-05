import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Project } from "@renvia/types";
import { useApiClient } from "../lib/apiClient";
import { formatRelativeTime } from "../lib/relativeTime";
import { PencilIcon, PlusIcon } from "./icons";
import { toActivity } from "./projectActivity";

const ACTIVITY_LIMIT = 30;

export function ActivitySection({ query = "" }: { query?: string }) {
  const api = useApiClient();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    setProjects(null);
    api.listProjects().then((result) => setProjects(result.projects)).catch(() => setFailed(true));
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const needle = query.trim().toLowerCase();
  const events = useMemo(() => {
    const all = toActivity(projects ?? [], ACTIVITY_LIMIT);
    return needle ? all.filter((event) => event.projectName.toLowerCase().includes(needle)) : all;
  }, [projects, needle]);

  if (failed) {
    return (
      <div className="feature-state is-error" role="alert">
        <p>Couldn't load your activity.</p>
        <button type="button" onClick={load}>Try again</button>
      </div>
    );
  }
  if (!projects) return <div className="feature-activity-list is-loading" role="status" aria-label="Loading activity" />;
  if (events.length === 0) {
    return (
      <div className="assets-empty feature-empty">
        <p className="assets-empty-title">{needle ? "No activity matches your search" : "No activity yet"}</p>
        <p>{needle ? "Try a different project name." : "Create or edit a project and it will show up here."}</p>
      </div>
    );
  }
  return (
    <div className="feature-activity-list">
      {events.map((event) => (
        <button key={event.key} type="button" className="feature-activity-item" onClick={() => navigate(`/project/${event.projectId}`)}>
          <span aria-hidden="true">{event.kind === "created" ? <PlusIcon /> : <PencilIcon />}</span>
          <div>
            <strong>{event.kind === "created" ? "You created" : "You edited"} {event.projectName}</strong>
            <small>{formatRelativeTime(event.at)}</small>
          </div>
        </button>
      ))}
    </div>
  );
}
