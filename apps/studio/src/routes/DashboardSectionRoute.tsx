import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { DashboardSidebar } from "../dashboard/DashboardSidebar";
import { DashboardTopBar } from "../dashboard/DashboardTopBar";
import { AssetsSection } from "../dashboard/AssetsSection";
import { TemplatesSection } from "../dashboard/TemplatesSection";
import { StudioPreferencesSection } from "../dashboard/StudioPreferencesSection";
import { BillingSection } from "../dashboard/BillingSection";
import { ActivitySection } from "../dashboard/ActivitySection";
import { useApiClient } from "../lib/apiClient";

export type SectionKey = "explore" | "templates" | "assets" | "ai-tools" | "team" | "settings" | "billing" | "activity";
const copy: Record<SectionKey, [string, string, string]> = {
  explore: ["Discover", "Explore architectural ideas", "A curated starting point for materials, moods, and presentation styles."], templates: ["Start faster", "Project templates", "Choose a proven visual direction, then make it your own in the Studio."], assets: ["Your library", "Assets and uploads", "Keep sketches, models, references, and finished renders in one place."], "ai-tools": ["Creative toolkit", "AI tools", "Focused workflows for rendering, regional edits, materials, and variations."], team: ["Collaboration", "Your team", "Invite collaborators and keep project feedback close to the work."], settings: ["Preferences", "Studio settings", "Defaults for new renders and edits, plus a way to replay the tour."], billing: ["Billing", "Credits and billing", "See your balance, top up render credits, and review past payments."], activity: ["Workspace history", "Recent activity", "When your projects were created and last edited."],
};
const cards: Partial<Record<SectionKey, Array<[string, string, string?]>>> = {
  explore: [["Warm minimal residences", "Natural timber, quiet stone, and generous daylight.", "/dashboard/house-exterior.jpg"], ["Modern lakeside living", "Low profiles and reflective landscapes.", "/dashboard/lakeside-house.jpg"], ["After-dark presentation", "Controlled contrast and believable interior light.", "/dashboard/house-dark.jpg"]],
  "ai-tools": [["Sketch to render", "Turn linework into a presentation-ready visualization."], ["Regional material edit", "Change one surface while preserving the building."], ["Design variations", "Explore alternate finishes without redrawing the project."]],
};
const SEARCH_PLACEHOLDER: Partial<Record<SectionKey, string>> = {
  explore: "Search directions…", "ai-tools": "Search tools…", templates: "Search templates…", assets: "Search assets…", activity: "Search activity…",
};

export function DashboardSectionRoute({ section }: { section: SectionKey }) {
  const api = useApiClient(); const navigate = useNavigate(); const location = useLocation();
  const [notice, setNotice] = useState(""); const [search, setSearch] = useState(""); const [creating, setCreating] = useState(false);
  const [eyebrow, title, description] = copy[section];
  const query = search.trim().toLowerCase();
  const sectionCards = cards[section] ?? [];
  const visibleCards = sectionCards.filter(([name, text]) => `${name} ${text}`.toLowerCase().includes(query));
  const filtersInPlace = section in SEARCH_PLACEHOLDER;
  const create = async (name = "Untitled project") => {
    if (creating) return;
    setCreating(true);
    try {
      const project = await api.createProject({ name });
      navigate(`/project/${project.id}`);
    } catch {
      setNotice("Couldn't create the project. Check your connection and try again.");
      setCreating(false);
    }
  };
  return <div className="dashboard-shell"><DashboardSidebar view="home" activeSection={section} onChangeView={() => navigate("/dashboard")}/><div className="dashboard-workspace"><DashboardTopBar value={search} onChange={setSearch} placeholder={SEARCH_PLACEHOLDER[section] ?? "Search projects…"} onSubmit={filtersInPlace ? undefined : (value) => navigate(`/dashboard?q=${encodeURIComponent(value)}`)} onNotifications={() => navigate("/activity")}/><main className="dashboard-feature-page">
    <button type="button" className="feature-back" onClick={() => navigate("/dashboard")}>← Dashboard</button><header><p>{eyebrow}</p><h1>{title}</h1><span>{description}</span></header>{notice && <div className="feature-notice" role="status">{notice}</div>}
    {visibleCards.length > 0 && <div className="feature-card-grid">{visibleCards.map(([name, text, image]) => <article key={name} className="feature-card">{image && <img src={image} alt={name}/>}<div><h2>{name}</h2><p>{text}</p><button type="button" disabled={creating} onClick={() => void create(name)}>{creating ? "Starting…" : "Use this direction →"}</button></div></article>)}</div>}
    {sectionCards.length > 0 && visibleCards.length === 0 && <div className="assets-empty feature-empty"><p className="assets-empty-title">Nothing matches “{search.trim()}”</p><p>Try a different word, or clear the search.</p></div>}
    {section === "assets" && <AssetsSection autoOpenUpload={location.search.includes("upload=1")} query={search} onNotice={setNotice} />}
    {section === "templates" && <TemplatesSection query={search} onNotice={setNotice} />}
    {section === "team" && <form className="feature-form-card" onSubmit={(event) => event.preventDefault()} aria-describedby="team-invite-status"><h2>Invite a collaborator</h2><p id="team-invite-status">Team invites are coming soon. Shared workspaces aren't available yet, so nothing is sent from here.</p><label>Email address<input name="email" type="email" placeholder="designer@studio.com" disabled/></label><label>Role<select name="role" disabled><option>Editor</option><option>Viewer</option><option>Administrator</option></select></label><button type="submit" disabled>Invites coming soon</button></form>}
    {section === "settings" && <StudioPreferencesSection onSaved={setNotice} />}
    {section === "billing" && <BillingSection api={api} />}
    {section === "activity" && <ActivitySection query={search} />}
  </main></div></div>;
}
