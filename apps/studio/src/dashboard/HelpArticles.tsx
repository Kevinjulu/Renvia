import { Link } from "react-router-dom";
import { HELP_ARTICLES } from "../help/content";

export function HelpArticles() {
  return (
    <section className="mt-12">
      <h2 className="font-display text-base font-semibold text-primary">Help articles</h2>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {HELP_ARTICLES.map((article) => (
          <Link
            key={article.slug}
            to={`/help/${article.slug}`}
            className="group overflow-hidden rounded-xl border border-hairline bg-white transition-colors hover:border-hairline-strong"
          >
            <div className="aspect-[16/9] overflow-hidden bg-surface-2">
              <img
                src={article.image}
                alt=""
                aria-hidden="true"
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              />
            </div>
            <div className="px-3.5 py-3">
              <p className="text-sm font-medium text-primary">{article.title}</p>
              <p className="mt-0.5 text-xs text-muted">{article.summary}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
