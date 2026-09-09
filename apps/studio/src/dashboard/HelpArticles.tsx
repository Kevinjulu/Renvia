import { Link } from "react-router-dom";
import { HELP_ARTICLES } from "../help/content";
import { LearnIcon } from "./icons";

export function HelpArticles() {
  return (
    <section className="mt-8">
      <h2 className="font-display text-base font-semibold text-primary">Help &amp; learning</h2>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {HELP_ARTICLES.map((article) => (
          <Link
            key={article.slug}
            to={`/help/${article.slug}`}
            className="group overflow-hidden rounded-xl border border-hairline bg-white transition-all hover:border-hairline-strong hover:shadow-[0_2px_10px_rgba(20,20,20,0.06)]"
          >
            <div className="aspect-[16/9] overflow-hidden bg-surface-2">
              <img
                src={article.image}
                alt=""
                aria-hidden="true"
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              />
            </div>
            <div className="flex gap-2.5 px-3.5 py-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface-muted text-muted">
                <LearnIcon />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-[18px] text-primary [text-wrap:pretty]">{article.title}</p>
                <p className="mt-0.5 text-xs text-faint">
                  {article.eyebrow} · {article.readTime}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
