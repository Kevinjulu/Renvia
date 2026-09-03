import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Logo } from "../components/brand/Logo";
import { AccountMenu } from "../components/account/AccountMenu";
import { getHelpArticle, slugify, HELP_ARTICLES } from "../help/content";

const ACCENT_DOT = {
  blueprint: "bg-blueprint",
  glow: "bg-glow",
} as const;

function TopNav() {
  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between border-b border-hairline bg-canvas/90 px-6 backdrop-blur sm:px-10">
      <Link to="/dashboard" aria-label="Renvia dashboard" className="inline-flex items-center">
        <Logo />
      </Link>
      <AccountMenu />
    </header>
  );
}

function CopyLinkButton() {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(window.location.href).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="flex items-center gap-2 text-sm text-secondary transition-colors hover:text-primary"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M6.5 9.5 9.5 6.5M6.8 4.3l1-1a2.5 2.5 0 0 1 3.5 3.5l-1.4 1.4M9.2 11.7l-1 1a2.5 2.5 0 0 1-3.5-3.5l1.4-1.4"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}

export function HelpArticleRoute() {
  const { slug } = useParams<{ slug: string }>();
  const article = getHelpArticle(slug);

  if (!article) {
    return (
      <div className="min-h-screen bg-canvas">
        <TopNav />
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-32 text-center">
          <p className="font-display text-lg font-semibold text-primary">Article not found</p>
          <Link to="/dashboard" className="text-sm font-medium text-blueprint hover:opacity-80">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const { Body } = article;
  const relatedArticles = HELP_ARTICLES.filter((candidate) => candidate.slug !== article.slug);
  const category = article.eyebrow.split("—").pop()?.trim() ?? article.eyebrow;

  return (
    <div className="min-h-screen bg-surface">
      <TopNav />

      <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-8 sm:pt-10">
        <div className="rounded-3xl bg-surface-2 p-6 sm:p-10">
          <div className="flex items-center gap-1.5 text-sm text-muted">
            <Link to="/dashboard" className="transition-colors hover:text-primary">
              Dashboard
            </Link>
            <span className="text-faint">›</span>
            <span>{category}</span>
          </div>

          <div className="mt-6 grid grid-cols-1 items-center gap-8 sm:grid-cols-2 sm:gap-10">
            <div>
              <h1 className="font-display text-3xl font-semibold leading-tight text-primary sm:text-4xl">
                {article.title}
              </h1>
              <div className="mt-4 flex items-center gap-2 text-sm text-muted">
                <span className={`h-1.5 w-1.5 rounded-full ${ACCENT_DOT[article.accent]}`} />
                {article.readTime}
              </div>
            </div>

            <img
              src={article.image}
              alt=""
              aria-hidden="true"
              className="aspect-[4/3] w-full rounded-2xl border border-hairline object-cover"
            />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-8 lg:grid lg:grid-cols-[240px_1fr] lg:gap-14">
        <aside className="hidden lg:block">
          <div className="sticky top-24 flex flex-col gap-6">
            <CopyLinkButton />

            <div className="rounded-xl bg-surface-muted p-4">
              <p className="font-mono text-xs uppercase tracking-wide text-faint">On this page</p>
              <nav className="mt-3 flex flex-col gap-2.5">
                {article.sections.map((section, index) => (
                  <a
                    key={section}
                    href={`#${slugify(section)}`}
                    className="flex items-baseline gap-2 text-sm text-secondary transition-colors hover:text-primary"
                  >
                    <span className="font-mono text-xs text-faint">{index + 1}</span>
                    {section}
                  </a>
                ))}
              </nav>
            </div>
          </div>
        </aside>

        <article>
          <div className="max-w-2xl">
            <Body />
          </div>

          <div className="mt-14 border-t border-hairline pt-8">
            <p className="font-mono text-xs uppercase tracking-wide text-faint">Continue reading</p>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {relatedArticles.map((related) => (
                <Link
                  key={related.slug}
                  to={`/help/${related.slug}`}
                  className="group overflow-hidden rounded-xl border border-hairline bg-white transition-colors hover:border-hairline-strong"
                >
                  <div className="aspect-[16/9] overflow-hidden bg-surface-2">
                    <img
                      src={related.image}
                      alt=""
                      aria-hidden="true"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  </div>
                  <div className="px-3.5 py-3">
                    <p className="text-sm font-medium text-primary">{related.title}</p>
                    <p className="mt-0.5 text-xs text-muted">{related.summary}</p>
                  </div>
                </Link>
              ))}
            </div>

            <div className="mt-10 flex items-center justify-between rounded-xl border border-hairline bg-white px-5 py-4">
              <p className="text-sm text-secondary">Ready to render?</p>
              <Link
                to="/dashboard"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                Back to dashboard
              </Link>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}
