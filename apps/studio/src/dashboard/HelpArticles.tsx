import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { getRecentlyViewed } from "../lib/localCollections";
import { HELP_ARTICLES } from "../help/content";

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

function tourHref(): string {
  const recent = getRecentlyViewed()[0];
  return recent ? `/project/${recent.id}?tour=1` : "/help/getting-started";
}

const ARTICLE_CARDS: Array<Pick<LearningItem, "slug" | "image" | "focus" | "icon" | "kind">> = [
  { slug: "getting-started", image: "/dashboard/lakeside-house-sketch.png", focus: "50% 55%", icon: "upload", kind: "Guide" },
  { slug: "consistent-results", image: "/dashboard/interior.jpg", focus: "50% 50%", icon: "spark", kind: "Tips" },
  { slug: "regional-editing", image: "/dashboard/lakeside-house.jpg", focus: "50% 60%", icon: "brush", kind: "Advanced" },
];

/** Article cards read their title, summary and read time from the help content, so they can't drift from it. */
const learning: LearningItem[] = [
  { slug: "tour", image: "/dashboard/house-detail.jpg", focus: "50% 38%", icon: "play", kind: "Tour", length: "Interactive", title: "Take the Studio tour", detail: "A guided walkthrough of the studio, from elevation slots to Generate." },
  ...ARTICLE_CARDS.flatMap((card) => {
    const article = HELP_ARTICLES.find((candidate) => candidate.slug === card.slug);
    return article ? [{ ...card, length: article.readTime, title: article.title, detail: article.summary }] : [];
  }),
];

export function HelpArticles() {
  return (
    <section className="dashboard-learning">
      <div className="dashboard-section-heading">
        <h2>Help &amp; learning</h2>
        <Link to="/help/getting-started">View all&nbsp; →</Link>
      </div>
      <div className="dashboard-learning-grid">
        {learning.map((item) => (
          <Link
            key={item.slug}
            to={item.slug === "tour" ? tourHref() : `/help/${item.slug}`}
            className="learning-card"
          >
            <div className="learning-card-media">
              <img src={item.image} alt="" loading="lazy" style={{ objectPosition: item.focus }} />
              <span className={`learning-card-kind ${item.icon === "play" ? "is-video" : ""}`}>
                <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[item.icon]}</svg>
                {item.kind}
              </span>
            </div>
            <div className="learning-card-body">
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
              <div className="learning-card-meta">
                <span>{item.length}</span>
                <span className="learning-card-cta">
                  {item.icon === "play" ? "Start" : "Read"}
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
