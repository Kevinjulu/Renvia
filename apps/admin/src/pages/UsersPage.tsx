import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { Card, EmptyState, ErrorNote, PageHeader, Pagination, Pill, Table } from "../components/ui";
import { useAdminApi } from "../lib/api";
import { formatNumber, formatRelative, formatUsd } from "../lib/format";
import { useLoad } from "../lib/useLoad";

const PAGE_SIZE = 25;

export function UsersPage() {
  const api = useAdminApi();
  const [params, setParams] = useSearchParams();
  const search = params.get("search") ?? "";
  const offset = Number(params.get("offset") ?? 0);
  const [draft, setDraft] = useState(search);

  // Debounce typing into the URL so every keystroke isn't a request.
  useEffect(() => {
    if (draft === search) return;
    const timeout = setTimeout(() => setParams(draft ? { search: draft } : {}), 300);
    return () => clearTimeout(timeout);
  }, [draft, search, setParams]);

  const { data, error, loading, reload } = useLoad(
    () => api.listUsers({ search, limit: PAGE_SIZE, offset }),
    [api, search, offset],
  );

  return (
    <>
      <PageHeader title="Users" description="Everyone who has signed in to the studio." />
      <Card
        actions={
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Search by email…"
              aria-label="Search users by email"
              className="w-64 rounded-xl border border-hairline bg-surface py-2 pl-9 pr-3 text-sm outline-none transition focus:border-blueprint focus:bg-canvas focus:ring-2 focus:ring-blueprint/15"
            />
          </div>
        }
        title={data ? `${formatNumber(data.total)} ${data.total === 1 ? "user" : "users"}` : "Users"}
      >
        {error && <ErrorNote onRetry={reload}>{error}</ErrorNote>}
        {data && data.users.length === 0 ? (
          <EmptyState icon={Search}>{search ? `No users match “${search}”.` : "No users yet."}</EmptyState>
        ) : (
          data && (
            <div className={loading ? "opacity-60 transition-opacity" : ""}>
              <Table head={["User", "Credits", "Renders", "Spend", "Last render", "Status"]}>
                {data.users.map((user) => (
                  <tr key={user.id} className="transition hover:bg-surface">
                    <td className="px-5 py-3">
                      <Link to={`/users/${user.id}`} className="group flex items-center gap-3">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-sheen text-xs font-semibold uppercase text-white">
                          {user.email.charAt(0)}
                        </span>
                        <span className="truncate font-medium text-primary group-hover:text-blueprint">{user.email}</span>
                      </Link>
                    </td>
                    <td className="px-5 py-3 tabular-nums">{user.role === "admin" ? <span className="text-faint">∞</span> : formatNumber(user.creditBalance)}</td>
                    <td className="px-5 py-3 tabular-nums">{formatNumber(user.renderCount)}</td>
                    <td className="px-5 py-3 tabular-nums">{formatUsd(user.spentUsd)}</td>
                    <td className="px-5 py-3 text-muted">{formatRelative(user.lastRenderAt)}</td>
                    <td className="px-5 py-3">
                      <div className="flex gap-1.5">
                        {user.role === "admin" && <Pill tone="blue">Admin</Pill>}
                        {user.disabled ? <Pill tone="red">Disabled</Pill> : <Pill tone="emerald">Active</Pill>}
                      </div>
                    </td>
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
