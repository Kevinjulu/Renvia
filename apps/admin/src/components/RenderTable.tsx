import { Link } from "react-router-dom";
import type { AdminRender } from "@renvia/types";
import { formatDateTime, formatModel, formatUsd } from "../lib/format";
import { Pill, StatusBadge, Table } from "./ui";

/** Renders and edits with thumbnails; used on the Renders page and a user's detail page. */
export function RenderTable({ renders, showUser = true }: { renders: AdminRender[]; showUser?: boolean }) {
  const head = ["Image", ...(showUser ? ["User"] : []), "Details", "Model", "Cost", "Status", "Created"];
  return (
    <Table head={head}>
      {renders.map((render) => (
        <tr key={render.id} className="align-top hover:bg-surface">
          <td className="px-5 py-3">
            <a
              href={render.resultImageUrl ?? render.sourceImageUrl}
              target="_blank"
              rel="noreferrer"
              title={render.resultImageUrl ? "Open result" : "Open source (no result)"}
              className="block h-12 w-16 overflow-hidden rounded-md border border-hairline bg-surface-muted"
            >
              <img
                src={render.resultImageUrl ?? render.sourceImageUrl}
                alt=""
                loading="lazy"
                className={`h-full w-full object-cover ${render.resultImageUrl ? "" : "opacity-40"}`}
              />
            </a>
          </td>
          {showUser && (
            <td className="px-5 py-3">
              <Link to={`/users/${render.userId}`} className="text-primary hover:text-blueprint">
                {render.userEmail}
              </Link>
              <p className="text-xs text-faint">{render.projectName}</p>
            </td>
          )}
          <td className="max-w-[260px] px-5 py-3">
            <div className="flex items-center gap-1.5">
              <Pill tone={render.kind === "edit" ? "amber" : "neutral"}>{render.kind === "edit" ? "Edit" : "Render"}</Pill>
              <span className="truncate text-xs text-muted">{[render.viewLabel, render.style].filter(Boolean).join(" · ")}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-secondary" title={render.prompt}>
              {render.prompt || <span className="text-faint">No prompt</span>}
            </p>
            {render.errorMessage && <p className="mt-1 line-clamp-2 text-xs text-red-600">{render.errorMessage}</p>}
          </td>
          <td className="px-5 py-3 font-mono text-xs text-secondary">{formatModel(render.model)}</td>
          <td className="px-5 py-3 tabular-nums">
            {formatUsd(render.costUsd)}
            <p className="text-xs text-faint">
              {render.creditsCharged} {render.creditsCharged === 1 ? "credit" : "credits"}
            </p>
          </td>
          <td className="px-5 py-3">
            <StatusBadge status={render.status} />
          </td>
          <td className="whitespace-nowrap px-5 py-3 text-xs text-muted">{formatDateTime(render.createdAt)}</td>
        </tr>
      ))}
    </Table>
  );
}
