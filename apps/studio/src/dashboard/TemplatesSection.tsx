import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApiClient } from "../lib/apiClient";
import { useGenerationSettingsStore } from "../canvas/hooks/useGenerationSettingsStore";
import { PROJECT_TEMPLATES, TEMPLATE_CATEGORIES, type TemplateCategory } from "./projectTemplates";

type Filter = "all" | TemplateCategory;

interface TemplatesSectionProps {
  onNotice: (message: string) => void;
}

/** Each template seeds a real style, aspect ratio, influence, and starter prompt — not just a project name. */
export function TemplatesSection({ onNotice }: TemplatesSectionProps) {
  const api = useApiClient();
  const navigate = useNavigate();
  const setPrompt = useGenerationSettingsStore((state) => state.setPrompt);
  const setStyle = useGenerationSettingsStore((state) => state.setStyle);
  const setAspectRatio = useGenerationSettingsStore((state) => state.setAspectRatio);
  const setStyleInfluence = useGenerationSettingsStore((state) => state.setStyleInfluence);

  const [filter, setFilter] = useState<Filter>("all");
  const [creatingId, setCreatingId] = useState<string | null>(null);

  const visible = filter === "all" ? PROJECT_TEMPLATES : PROJECT_TEMPLATES.filter((template) => template.category === filter);

  const startFromTemplate = async (id: string) => {
    const template = PROJECT_TEMPLATES.find((item) => item.id === id);
    if (!template || creatingId) return;
    setCreatingId(id);
    try {
      const project = await api.createProject({ name: template.label });
      setStyle(template.category);
      setAspectRatio(template.aspectRatio);
      setStyleInfluence(template.styleInfluence);
      setPrompt(template.prompt);
      navigate(`/project/${project.id}`);
    } catch {
      onNotice("Couldn't start a project from that template. Try again.");
      setCreatingId(null);
    }
  };

  return (
    <div className="templates-page">
      <div className="assets-toolbar">
        <button type="button" className={filter === "all" ? "is-active" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
          All
          <span>{PROJECT_TEMPLATES.length}</span>
        </button>
        {TEMPLATE_CATEGORIES.map((category) => {
          const count = PROJECT_TEMPLATES.filter((template) => template.category === category).length;
          if (!count) return null;
          return (
            <button key={category} type="button" className={filter === category ? "is-active" : ""} aria-pressed={filter === category} onClick={() => setFilter(category)}>
              {category}
              <span>{count}</span>
            </button>
          );
        })}
      </div>

      <div className="template-grid">
        {visible.map((template) => (
          <article key={template.id} className="template-card">
            <div className="template-card-image">
              <img src={template.thumb} alt="" />
              <span className="template-card-category">{template.category}</span>
            </div>
            <div>
              <h2>{template.label}</h2>
              <p>{template.description}</p>
              <button type="button" disabled={creatingId !== null} onClick={() => void startFromTemplate(template.id)}>
                {creatingId === template.id ? "Starting…" : "Use this template →"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
