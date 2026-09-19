import type { ReactNode } from "react";
import { Link } from "react-router-dom";

const ICONS: Record<string, ReactNode> = {
  play: <path d="M8 5.5v13l10.5-6.5Z" />,
  upload: <><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" /><path d="M4.5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V15" /></>,
  spark: <path d="M12 3.5 13.9 9l5.6 2-5.6 2L12 18.5 10.1 13l-5.6-2 5.6-2Z" />,
  brush: <><path d="M14.5 4.5 19.5 9.5 11 18l-5 1 1-5Z" /><path d="m13 6 5 5" /></>,
};

interface LearningItem {
  slug: string;
  image: string;
  /** Keeps the subject of portrait/wide photos in frame at the card's 16:10 crop. */
  focus: string;
  icon: keyof typeof ICONS;
  kind: string;
  length: string;
  title: string;
  detail: string;
}

const learning: LearningItem[] = [
  { slug: "getting-started", image: "/dashboard/house-detail.jpg", focus: "50% 38%", icon: "play", kind: "Video", length: "5 min", title: "Getting started with Renvia", detail: "A quick tour from first upload to finished render." },
  { slug: "getting-started", image: "/dashboard/lakeside-house-sketch.png", focus: "50% 55%", icon: "upload", kind: "Guide", length: "4 min read", title: "Uploading your model or sketch", detail: "Prepare elevations, sketches and exports for clean results." },
  { slug: "consistent-results", image: "/dashboard/interior.jpg", focus: "50% 50%", icon: "spark", kind: "Tips", length: "6 min read", title: "Prompting for better results", detail: "Describe materials, light and mood with examples that work." },
  { slug: "regional-editing", image: "/dashboard/lakeside-house.jpg", focus: "50% 60%", icon: "brush", kind: "Advanced", length: "7 min read", title: "Advanced editing techniques", detail: "Refine regions of a render without losing the structure." },
];

export function HelpArticles() {
  return (
    <section className="dashboard-learning">
      <div className="dashboard-section-heading">
        <h2>Help &amp; learning</h2>
        <Link to="/help/getting-started">View all&nbsp; →</Link>
      </div>
      <div className="dashboard-learning-grid">
        {learning.map((item, index) => (
          <Link key={`${item.slug}-${index}`} to={`/help/${item.slug}`} className="learning-card">
            <div className="learning-card-media">
              <img src={item.image} alt="" loading="lazy" style={{ objectPosition: item.focus }} />
              <span className={`learning-card-kind ${item.icon === "play" ? "is-video" : ""}`}>
                <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[item.icon]}</svg>
                {item.kind}
              </span>
              {item.icon === "play" && (
                <span className="learning-card-play" aria-hidden="true">
                  <svg viewBox="0 0 24 24">{ICONS.play}</svg>
                </span>
              )}
            </div>
            <div className="learning-card-body">
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
              <div className="learning-card-meta">
                <span>{item.length}</span>
                <span className="learning-card-cta">
                  {item.icon === "play" ? "Watch" : "Read"}
                  <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6h7M6.5 2.5 10 6l-3.5 3.5" /></svg>
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
