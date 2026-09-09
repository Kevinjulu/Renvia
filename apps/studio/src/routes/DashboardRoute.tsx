import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "@clerk/react";
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
import { HomeHero } from "../dashboard/HomeHero";
import { HomeRail } from "../dashboard/HomeRail";
import { ChevronRightIcon } from "../dashboard/icons";
import { ConfirmDialog } from "../components/ConfirmDialog";

const VIEW_TITLE: Record<DashboardView, string> = {
  home: "Home",
  all: "All projects",
  favorites: "Favorites",
};

const RECENT_LIMIT = 7;

function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function DashboardRoute() {
  const apiClient = useApiClient();
  const navigate = useNavigate();
  const { user } = useUser();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [view, setView] = useState<DashboardView>("home");
  const [search, setSearch] = useState("");
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

  const query = search.trim().toLowerCase();
  const isSearching = query.length > 0;

  const visibleProjects = useMemo(() => {
    if (isSearching) return sortedProjects.filter((project) => project.name.toLowerCase().includes(query));
    if (view === "favorites") return sortedProjects.filter((project) => favoriteIds.includes(project.id));
    if (view === "home") return sortedProjects.slice(0, RECENT_LIMIT);
    return sortedProjects;
  }, [isSearching, query, view, sortedProjects, favoriteIds]);

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

  const isHome = view === "home" && !isSearching;
  const heading = isSearching
    ? `${visibleProjects.length} ${visibleProjects.length === 1 ? "result" : "results"} for “${search.trim()}”`
    : view === "home"
      ? "Recent projects"
      : VIEW_TITLE[view];
  const showNewTile = !isSearching && view !== "favorites";

  return (
    <div className="flex h-screen bg-surface">
      <DashboardSidebar view={view} onChangeView={setView} recentlyViewed={recentlyViewed} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <DashboardTopBar title={VIEW_TITLE[view]} search={search} onSearchChange={setSearch} />

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[1400px] gap-8 px-8 py-8">
            <main className="min-w-0 flex-1">
              {isHome && (
                <>
                  <h2 className="font-display text-[32px] font-semibold leading-[38px] tracking-[-0.015em] text-primary">
                    {greetingFor(new Date())}
                    {user?.firstName ? `, ${user.firstName}` : ""}
                  </h2>
                  <p className="mt-1.5 text-sm text-muted">
                    Turn your elevations into photoreal renders — your design, sharpened.
                  </p>

                  <div className="mt-6">
                    <HomeHero onCreate={() => void handleCreate()} isCreating={isCreating} />
                  </div>
                </>
              )}

              <div className={`flex items-center justify-between ${isHome ? "mt-8" : ""}`}>
                <h3 className="font-display text-base font-semibold text-primary">{heading}</h3>
                {isHome && sortedProjects.length > RECENT_LIMIT && (
                  <button
                    type="button"
                    onClick={() => setView("all")}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-surface-muted px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-surface-2"
                  >
                    View all
                    <ChevronRightIcon />
                  </button>
                )}
              </div>

              {isLoading ? (
                <p className="mt-8 text-sm text-muted">Loading…</p>
              ) : isSearching && visibleProjects.length === 0 ? (
                <p className="mt-8 text-sm text-muted">No projects match that search.</p>
              ) : view === "favorites" && visibleProjects.length === 0 ? (
                <p className="mt-8 text-sm text-muted">No favorites yet — star a project to pin it here.</p>
              ) : (
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
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

              {isHome && <HelpArticles />}
            </main>

            {isHome && <HomeRail projects={sortedProjects} onCreate={() => void handleCreate()} isCreating={isCreating} />}
          </div>
        </div>
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
