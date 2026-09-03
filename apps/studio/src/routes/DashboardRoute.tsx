import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Project } from "@renvia/types";
import { useApiClient } from "../lib/apiClient";
import {
  getFavoriteIds,
  getRecentlyViewed,
  removeProjectFromCollections,
  renameInRecentlyViewed,
  toggleFavorite,
  type RecentlyViewedEntry,
} from "../lib/localCollections";
import { DashboardSidebar, type DashboardView } from "../dashboard/DashboardSidebar";
import { DashboardTopBar } from "../dashboard/DashboardTopBar";
import { NewProjectTile, ProjectCard } from "../dashboard/ProjectCard";
import { HelpArticles } from "../dashboard/HelpArticles";
import { ConfirmDialog } from "../components/ConfirmDialog";

const VIEW_TITLE: Record<DashboardView, string> = {
  home: "Home",
  all: "All projects",
  favorites: "Favorites",
};

const RECENT_LIMIT = 7;

export function DashboardRoute() {
  const apiClient = useApiClient();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [view, setView] = useState<DashboardView>("home");
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [recentlyViewed, setRecentlyViewed] = useState<RecentlyViewedEntry[]>([]);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    apiClient
      .listProjects()
      .then((result) => setProjects(result.projects))
      .finally(() => setIsLoading(false));
    setFavoriteIds(getFavoriteIds());
    setRecentlyViewed(getRecentlyViewed());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [projects],
  );

  const visibleProjects = useMemo(() => {
    if (view === "favorites") return sortedProjects.filter((project) => favoriteIds.includes(project.id));
    if (view === "home") return sortedProjects.slice(0, RECENT_LIMIT);
    return sortedProjects;
  }, [view, sortedProjects, favoriteIds]);

  const handleOpen = (project: Project) => {
    navigate(`/project/${project.id}`);
  };

  const handleToggleFavorite = (projectId: string) => {
    setFavoriteIds(toggleFavorite(projectId));
  };

  const handleRename = async (projectId: string, name: string) => {
    const updated = await apiClient.updateProject(projectId, { name });
    setProjects((current) => current.map((project) => (project.id === projectId ? updated : project)));
    renameInRecentlyViewed(projectId, name);
    setRecentlyViewed(getRecentlyViewed());
  };

  const handleConfirmDelete = async () => {
    if (!deletingProject) return;
    setIsDeleting(true);
    try {
      await apiClient.deleteProject(deletingProject.id);
      setProjects((current) => current.filter((project) => project.id !== deletingProject.id));
      removeProjectFromCollections(deletingProject.id);
      setFavoriteIds((ids) => ids.filter((id) => id !== deletingProject.id));
      setRecentlyViewed((entries) => entries.filter((entry) => entry.id !== deletingProject.id));
      setDeletingProject(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      const project = await apiClient.createProject({ name: `Project (${projects.length + 1})` });
      navigate(`/project/${project.id}`);
    } finally {
      setIsCreating(false);
    }
  };

  const heading = view === "home" ? "Recent projects" : VIEW_TITLE[view];
  const showNewTile = view !== "favorites";

  return (
    <div className="flex h-screen bg-surface">
      <DashboardSidebar view={view} onChangeView={setView} recentlyViewed={recentlyViewed} />

      <div className="flex flex-1 flex-col overflow-y-auto">
        <DashboardTopBar title={VIEW_TITLE[view]} />

        <main className="mx-auto w-full max-w-6xl px-8 py-8">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-primary">{heading}</h2>
            {view === "home" && sortedProjects.length > RECENT_LIMIT && (
              <button
                type="button"
                onClick={() => setView("all")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-surface-muted px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-surface-2"
              >
                View all
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M2.5 6h7M6.5 2.5 10 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>

          {isLoading ? (
            <p className="mt-8 text-sm text-muted">Loading…</p>
          ) : view === "favorites" && visibleProjects.length === 0 ? (
            <p className="mt-8 text-sm text-muted">No favorites yet — star a project to pin it here.</p>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {showNewTile && <NewProjectTile onClick={() => void handleCreate()} disabled={isCreating} />}
              {visibleProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  favorite={favoriteIds.includes(project.id)}
                  onOpen={() => handleOpen(project)}
                  onToggleFavorite={() => handleToggleFavorite(project.id)}
                  onRename={(name) => handleRename(project.id, name)}
                  onRequestDelete={() => setDeletingProject(project)}
                />
              ))}
            </div>
          )}

          {view === "home" && <HelpArticles />}
        </main>
      </div>

      {deletingProject && (
        <ConfirmDialog
          title={`Delete "${deletingProject.name}"?`}
          description="This permanently deletes the project and its renders. This can't be undone."
          confirmLabel="Delete project"
          isConfirming={isDeleting}
          onConfirm={() => void handleConfirmDelete()}
          onCancel={() => setDeletingProject(null)}
        />
      )}
    </div>
  );
}
