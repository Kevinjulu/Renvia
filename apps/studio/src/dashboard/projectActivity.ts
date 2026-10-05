import type { Project } from "@renvia/types";

export interface ActivityEvent {
  key: string;
  kind: "created" | "edited";
  projectId: string;
  projectName: string;
  at: string;
}

/**
 * Activity is derived from the projects themselves — there is no activity table yet,
 * so this reports only what the project rows actually record: when each was created
 * and when it was last edited.
 */
export function toActivity(projects: Project[], limit = 5): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const project of projects) {
    events.push({ key: `${project.id}-created`, kind: "created", projectId: project.id, projectName: project.name, at: project.createdAt });

    const createdAt = new Date(project.createdAt).getTime();
    const updatedAt = new Date(project.updatedAt).getTime();
    if (updatedAt - createdAt > 60_000) {
      events.push({ key: `${project.id}-edited`, kind: "edited", projectId: project.id, projectName: project.name, at: project.updatedAt });
    }
  }

  return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, limit);
}
