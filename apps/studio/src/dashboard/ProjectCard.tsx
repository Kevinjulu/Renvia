import { useEffect, useRef, useState } from "react";
import type { Project } from "@renvia/types";
import { formatRelativeTime } from "../lib/relativeTime";
import { ProjectCardMenu } from "./ProjectCardMenu";

export function NewProjectTile({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-hairline-strong bg-white text-faint transition-colors hover:border-blueprint hover:text-blueprint disabled:opacity-50"
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 3.5v13M3.5 10h13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <span className="text-sm font-medium">{disabled ? "Creating…" : "New project"}</span>
    </button>
  );
}

interface ProjectCardProps {
  project: Project;
  favorite: boolean;
  onOpen: () => void;
  onToggleFavorite: () => void;
  onRename: (name: string) => Promise<void>;
  onRequestDelete: () => void;
}

export function ProjectCard({ project, favorite, onOpen, onToggleFavorite, onRename, onRequestDelete }: ProjectCardProps) {
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(project.name);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!renaming) setValue(project.name);
  }, [project.name, renaming]);

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

  const commitRename = async () => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === project.name) {
      setValue(project.name);
      setRenaming(false);
      return;
    }
    setSaving(true);
    try {
      await onRename(trimmed);
    } finally {
      setSaving(false);
      setRenaming(false);
    }
  };

  return (
    <div className="group relative flex aspect-[4/3] flex-col overflow-hidden rounded-xl border border-hairline bg-white transition-colors hover:border-hairline-strong">
      <button
        type="button"
        onClick={onOpen}
        disabled={renaming}
        className="relative flex flex-1 items-center justify-center overflow-hidden bg-surface-2 disabled:cursor-default"
      >
        <span className="font-display text-4xl font-semibold text-hairline-strong">
          {project.name.trim().charAt(0).toUpperCase() || "P"}
        </span>
      </button>

      <div className="absolute right-2.5 top-2.5 flex items-center gap-1.5">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite();
          }}
          aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={favorite}
          className={`flex h-7 w-7 items-center justify-center rounded-full bg-white/90 backdrop-blur transition-opacity ${
            favorite ? "text-glow opacity-100" : "text-faint opacity-0 group-hover:opacity-100"
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill={favorite ? "currentColor" : "none"} aria-hidden="true">
            <path
              d="M8 2.3 9.8 6l4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4L2.2 6.6l4-.6Z"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <ProjectCardMenu onRename={() => setRenaming(true)} onDelete={onRequestDelete} />
      </div>

      <div className="flex flex-col items-start gap-0.5 px-3.5 py-3 text-left">
        {renaming ? (
          <input
            ref={inputRef}
            value={value}
            disabled={saving}
            onChange={(event) => setValue(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onBlur={() => void commitRename()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void commitRename();
              }
              if (event.key === "Escape") {
                setValue(project.name);
                setRenaming(false);
              }
            }}
            className="w-full rounded border border-blueprint bg-white px-1.5 py-0.5 text-sm font-medium text-primary outline-none"
          />
        ) : (
          <button type="button" onClick={onOpen} className="max-w-full truncate text-sm font-medium text-primary hover:underline">
            {project.name}
          </button>
        )}
        <span className="text-xs text-muted">Edited {formatRelativeTime(project.updatedAt)}</span>
      </div>
    </div>
  );
}
