import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
          <input
            type="search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Search by email…"
            aria-label="Search users by email"
            className="w-64 rounded-lg border border-hairline px-3 py-1.5 text-sm outline-none focus:border-blueprint"
          />
        }
        title={data ? `${formatNumber(data.total)} ${data.total === 1 ? "user" : "users"}` : "Users"}
      >
        {error && <ErrorNote onRetry={reload}>{error}</ErrorNote>}
        {data && data.users.length === 0 ? (
          <EmptyState>{search ? `No users match “${search}”.` : "No users yet."}</EmptyState>
        ) : (
          data && (
            <div className={loading ? "opacity-60 transition-opacity" : ""}>
              <Table head={["Email", "Credits", "Renders", "Spend", "Last render", "Status"]}>
                {data.users.map((user) => (
                  <tr key={user.id} className="hover:bg-surface">
                    <td className="px-5 py-3">
                      <Link to={`/users/${user.id}`} className="font-medium text-primary hover:text-blueprint">
                        {user.email}
                      </Link>
                    </td>
                    <td className="px-5 py-3 tabular-nums">{user.role === "admin" ? <span className="text-faint">∞</span> : formatNumber(user.creditBalance)}</td>
                    <td className="px-5 py-3 tabular-nums">{formatNumber(user.renderCount)}</td>
                    <td className="px-5 py-3 tabular-nums">{formatUsd(user.spentUsd)}</td>
                    <td className="px-5 py-3 text-muted">{formatRelative(user.lastRenderAt)}</td>
                    <td className="px-5 py-3">
                      <div className="flex gap-1.5">
                        {user.role === "admin" && <Pill tone="blue">Admin</Pill>}
                        {user.disabled ? <Pill tone="red">Disabled</Pill> : <Pill>Active</Pill>}
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
