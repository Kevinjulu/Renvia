import { Link } from "react-router-dom";

const learning = [
  { slug: "getting-started", image: "/dashboard/house-detail.jpg", badge: "▶", title: "Getting started with Renvia", detail: "5 min watch" },
  { slug: "getting-started", image: "/dashboard/lakeside-house-sketch.png", badge: "↥", title: "Uploading your model or sketch", detail: "Step-by-step guide" },
  { slug: "consistent-results", image: "/dashboard/interior.jpg", badge: "✣", title: "Prompting for better results", detail: "Tips and examples" },
  { slug: "regional-editing", image: "/dashboard/lakeside-house.jpg", badge: "‹›", title: "Advanced editing techniques", detail: "Learn how to refine your renders" },
];

export function HelpArticles() {
  return <section className="dashboard-learning"><div className="dashboard-section-heading"><h2>Help &amp; learning</h2><Link to="/help/getting-started">View all&nbsp; →</Link></div><div className="dashboard-learning-grid">{learning.map((item, index) => <Link key={`${item.slug}-${index}`} to={`/help/${item.slug}`} className="dashboard-learning-card"><div><img src={item.image} alt=""/><span>{item.badge}</span>{index === 2 && <em>Modern minimal house, warm<br/>golden hour, realistic, same structure...</em>}</div><p><b>{item.title}</b><small>{item.detail}</small></p></Link>)}</div></section>;
}
