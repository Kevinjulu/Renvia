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
      className="dashboard-new-project"
    >
      <span className="dashboard-new-plus"><svg width="22" height="22" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 3.5v13M3.5 10h13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg></span>
      <strong>{disabled ? "Creating…" : "New project"}</strong>
      <small>Start with a sketch, model or<br/>photo</small>
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
  const fallbackImages = ["/dashboard/house-exterior.jpg", "/dashboard/house-interior.png", "/dashboard/house-dark.jpg"];
  const fallbackIndex = [...project.id].reduce((total, character) => total + character.charCodeAt(0), 0) % fallbackImages.length;

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
    <div className="dashboard-project-card group">
      <button
        type="button"
        onClick={onOpen}
        disabled={renaming}
        className="dashboard-project-image"
      >
        <img src={project.thumbnailUrl || fallbackImages[fallbackIndex]} alt="" />
      </button>

      <div className="dashboard-project-actions">
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

      <div className="dashboard-project-meta">
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
            className="dashboard-rename-input"
          />
        ) : (
          <button type="button" onClick={onOpen}>
            {project.name}
          </button>
        )}
        <span>Edited {formatRelativeTime(project.updatedAt)}</span>
        <div className="dashboard-project-tags"><i>Render</i><i>Exterior</i></div>
      </div>
    </div>
  );
}
