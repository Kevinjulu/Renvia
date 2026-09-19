import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FolderKanban, Search } from "lucide-react";
import { Card, EmptyState, ErrorNote, PageHeader, Pagination, Table } from "../components/ui";
import { useAdminApi } from "../lib/api";
import { formatNumber, formatRelative, formatUsd } from "../lib/format";
import { useLoad } from "../lib/useLoad";

const PAGE_SIZE = 25;

export function ProjectsPage() {
  const api = useAdminApi();
  const [params, setParams] = useSearchParams();
  const search = params.get("search") ?? "";
  const offset = Number(params.get("offset") ?? 0);
  const [draft, setDraft] = useState(search);

  useEffect(() => {
    if (draft === search) return;
    const timeout = setTimeout(() => setParams(draft ? { search: draft } : {}), 300);
    return () => clearTimeout(timeout);
  }, [draft, search, setParams]);

  const { data, error, loading, reload } = useLoad(
    () => api.listProjects({ search, limit: PAGE_SIZE, offset }),
    [api, search, offset],
  );

  return (
    <>
      <PageHeader title="Projects" description="Every studio project, with owner and render activity." />
      <Card
        icon={FolderKanban}
        title={data ? `${formatNumber(data.total)} ${data.total === 1 ? "project" : "projects"}` : "Projects"}
        actions={
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Search name or owner…"
              aria-label="Search projects"
              className="w-64 rounded-xl border border-hairline bg-surface py-2 pl-9 pr-3 text-sm outline-none transition focus:border-blueprint focus:bg-canvas focus:ring-2 focus:ring-blueprint/15"
            />
          </div>
        }
      >
        {error && <ErrorNote onRetry={reload}>{error}</ErrorNote>}
        {data && data.projects.length === 0 ? (
          <EmptyState icon={FolderKanban}>{search ? `No projects match “${search}”.` : "No projects yet."}</EmptyState>
        ) : (
          data && (
            <div className={loading ? "opacity-60 transition-opacity" : ""}>
              <Table head={["Project", "Owner", "Renders", "Spend", "Last render", "Updated"]}>
                {data.projects.map((project) => (
                  <tr key={project.id} className="transition hover:bg-surface">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="block h-11 w-14 shrink-0 overflow-hidden rounded-lg border border-hairline bg-surface-muted">
                          {project.thumbnailUrl ? (
                            <img src={project.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                          ) : null}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-primary">{project.name}</p>
                          <p className="truncate font-mono text-[11px] text-faint">{project.id.slice(0, 8)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <Link to={`/users/${project.ownerId}`} className="text-primary hover:text-blueprint">
                        {project.ownerEmail}
                      </Link>
                    </td>
                    <td className="px-5 py-3 tabular-nums">{formatNumber(project.renderCount)}</td>
                    <td className="px-5 py-3 tabular-nums">{formatUsd(project.spentUsd)}</td>
                    <td className="px-5 py-3 text-muted">{formatRelative(project.lastRenderAt)}</td>
                    <td className="px-5 py-3 text-muted">{formatRelative(project.updatedAt)}</td>
                  </tr>
                ))}
              </Table>
              <Pagination
                offset={offset}
                limit={PAGE_SIZE}
                total={data.total}
                onChange={(next) => setParams({ ...(search ? { search } : {}), ...(next ? { offset: String(next) } : {}) })}
              />
            </div>
          )
        )}
      </Card>
    </>
  );
}
