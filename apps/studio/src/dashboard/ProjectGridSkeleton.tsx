const SKELETON_CARD_COUNT = 5;

export function ProjectGridSkeleton() {
  return (
    <div className="dashboard-project-grid dashboard-project-skeleton-grid" aria-label="Loading projects" aria-busy="true">
      {Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
        <div className="dashboard-project-skeleton" key={index} aria-hidden="true">
          <div className="dashboard-skeleton dashboard-project-skeleton-image" />
          <div className="dashboard-project-skeleton-meta">
            <div className="dashboard-skeleton dashboard-project-skeleton-title" />
            <div className="dashboard-skeleton dashboard-project-skeleton-detail" />
            <div className="dashboard-skeleton dashboard-project-skeleton-tag" />
          </div>
        </div>
      ))}
      <span className="sr-only" role="status">Loading your projects…</span>
    </div>
  );
}
