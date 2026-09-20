import type { ReactNode } from "react";

interface PageHeroProps {
  title: string;
  description: string;
  /** Absolute path under admin public, e.g. /banners/exterior-1.jpg */
  image: string;
  eyebrow?: string;
  actions?: ReactNode;
}

/**
 * Full-width photo banner for each admin tab — product imagery with a dark wash so
 * title and description stay readable. Keeps one composition: brand context + purpose.
 */
export function PageHero({ title, description, image, eyebrow = "Renvia Admin", actions }: PageHeroProps) {
  return (
    <header className="relative mb-8 overflow-hidden rounded-2xl border border-hairline shadow-card">
      <div className="absolute inset-0">
        <img src={image} alt="" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink-950/88 via-ink-950/72 to-ink-950/35" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950/50 via-transparent to-ink-950/20" />
      </div>

      <div className="relative flex min-h-[168px] flex-col justify-end gap-4 p-6 sm:min-h-[188px] sm:flex-row sm:items-end sm:justify-between sm:p-8">
        <div className="min-w-0 max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">{eyebrow}</p>
          <h1 className="mt-2 font-display text-[28px] font-bold leading-tight tracking-tight text-white sm:text-[32px]">
            {title}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-white/75 sm:text-[15px]">{description}</p>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
