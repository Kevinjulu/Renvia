import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Footer } from "@/components/footer/Footer";
import { Navbar } from "@/components/nav/Navbar";
import { ARTICLES, getArticle } from "@/lib/articles";
import { SIGNUP_URL } from "@/lib/config";

export function generateStaticParams() { return ARTICLES.map(({ slug }) => ({ slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> { const article = getArticle((await params).slug); return article ? { title: `${article.title} — Renvia`, description: article.dek } : {}; }

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const article = getArticle((await params).slug); if (!article) notFound();
  const related = ARTICLES.filter((item) => item.slug !== article.slug);
  return <><Navbar/><main className="px-6 pb-24 pt-32 sm:pt-40"><article className="mx-auto max-w-[1180px]">
    <header className="grid gap-10 border-b border-hairline pb-12 lg:grid-cols-[1fr_280px] lg:items-end"><div><Link href="/blog" className="text-xs text-muted transition-colors hover:text-primary">Journal / {article.category}</Link><h1 className="mt-6 max-w-[19ch] font-display text-4xl font-semibold leading-[1.04] tracking-[-0.04em] text-primary sm:text-6xl">{article.title}</h1><p className="mt-6 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">{article.dek}</p></div><dl className="grid grid-cols-2 gap-6 text-xs lg:grid-cols-1"><div><dt className="uppercase tracking-wider text-faint">Published</dt><dd className="mt-1 text-primary">{article.date}</dd></div><div><dt className="uppercase tracking-wider text-faint">Reading time</dt><dd className="mt-1 text-primary">{article.readTime}</dd></div></dl></header>
    <div className="relative mt-10 aspect-[16/8] overflow-hidden rounded-2xl bg-surface"><Image src={article.image} alt={article.imageAlt} fill priority sizes="(max-width: 1200px) 100vw, 1180px" className="object-cover"/></div>
    <div className="mx-auto mt-16 grid max-w-[940px] gap-12 lg:grid-cols-[190px_1fr]"><aside><p className="text-xs uppercase tracking-wider text-faint">In this article</p><nav className="mt-4 flex flex-col gap-3">{article.sections.map((section, index) => <a key={section.title} href={`#section-${index}`} className="text-xs leading-snug text-muted transition-colors hover:text-primary">{String(index + 1).padStart(2,"0")} — {section.title}</a>)}</nav></aside><div>{article.sections.map((section, index) => <section id={`section-${index}`} key={section.title} className="mb-16 scroll-mt-28"><p className="text-xs font-medium text-blueprint">{String(index + 1).padStart(2,"0")}</p><h2 className="mt-3 font-display text-2xl font-semibold tracking-tight text-primary sm:text-3xl">{section.title}</h2>{section.paragraphs.map((paragraph) => <p key={paragraph} className="mt-5 text-[15px] leading-8 text-muted">{paragraph}</p>)}{section.points && <ul className="mt-6 grid gap-2 border-l-2 border-primary pl-5">{section.points.map((point) => <li key={point} className="text-sm text-primary">{point}</li>)}</ul>}</section>)}<blockquote className="rounded-2xl bg-primary p-8 font-display text-xl leading-relaxed text-white sm:p-10 sm:text-2xl">“{article.takeaway}”</blockquote></div></div>
    <section className="mt-24 border-t border-hairline pt-12"><div className="flex items-end justify-between"><h2 className="font-display text-3xl font-semibold">More from the journal</h2><Link href="/blog" className="hidden text-sm text-muted sm:block">View all →</Link></div><div className="mt-8 grid gap-5 md:grid-cols-2">{related.map((item) => <Link key={item.slug} href={`/blog/${item.slug}`} className="group rounded-xl border border-hairline p-6 transition-colors hover:border-hairline-strong"><p className="text-xs text-faint">{item.category} · {item.readTime}</p><h3 className="mt-3 font-display text-xl font-semibold group-hover:underline">{item.title}</h3><span className="mt-6 inline-block text-sm">Read article →</span></Link>)}</div></section>
    <section className="mt-20 flex flex-col items-start justify-between gap-6 rounded-2xl bg-surface-2 p-8 sm:flex-row sm:items-center sm:p-10"><h2 className="font-display text-2xl font-semibold">Start with your own elevation.</h2><a href={SIGNUP_URL} className="rounded-full bg-primary px-6 py-3 text-sm font-medium text-white">Open Renvia Studio →</a></section>
  </article></main><Footer/></>;
}
