"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { LOGIN_URL, SIGNUP_URL } from "@/lib/config";

const NAV_LINKS = [
  { label: "Product", href: "/#features", index: "01" },
  { label: "Pricing", href: "/pricing", index: "02" },
  { label: "How it works", href: "/#how-it-works", index: "03" },
  { label: "Journal", href: "/blog", index: "04" },
] as const;

function ArrowIcon() {
  return <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true"><path d="M3 7.5h9M8.5 3.5l4 4-4 4" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function MenuIcon({ open }: { open: boolean }) {
  return <span className="relative block h-4 w-5" aria-hidden="true">
    <span className={`absolute left-0 top-[3px] h-px w-5 bg-current transition-transform duration-300 ${open ? "translate-y-[5px] rotate-45" : ""}`} />
    <span className={`absolute left-0 top-[8px] h-px bg-current transition-all duration-300 ${open ? "w-5 opacity-0" : "w-3.5"}`} />
    <span className={`absolute left-0 top-[13px] h-px w-5 bg-current transition-transform duration-300 ${open ? "-translate-y-[5px] -rotate-45" : ""}`} />
  </span>;
}

export function Navbar() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [menuOpen]);

  useEffect(() => setMenuOpen(false), [pathname]);

  const isActive = (href: string) => href === "/#features" ? pathname === "/" : !href.startsWith("/#") && pathname.startsWith(href);

  return <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4">
    <div className={`mx-auto max-w-[1400px] rounded-[18px] border transition-all duration-300 ${scrolled || menuOpen ? "border-black/[0.09] bg-[#fdfdfc]/92 shadow-[0_18px_55px_-28px_rgba(20,20,18,.38)] backdrop-blur-xl" : "border-black/[0.06] bg-[#fdfdfc]/78 shadow-[0_12px_40px_-30px_rgba(20,20,18,.28)] backdrop-blur-md"}`}>
      <div className="flex h-[62px] items-center justify-between px-4 sm:px-5">
        <Link href="/" aria-label="Renvia home" className="group flex items-center gap-3.5">
          <span className="grid h-9 w-9 place-items-center rounded-[11px] border border-black/[0.08] bg-[#151716] text-[10px] font-semibold text-white shadow-[0_8px_20px_-12px_rgba(0,0,0,.8)] transition-transform duration-300 group-hover:-rotate-3">R</span>
          <span className="flex flex-col gap-0.5">
            <Logo wordmarkClassName="text-[17px]" />
            <span className="font-mono text-[8px] font-medium uppercase tracking-[0.22em] text-[#8b8b85]">Visual intelligence</span>
          </span>
        </Link>

        <nav aria-label="Primary navigation" className="hidden items-center rounded-[13px] border border-black/[0.06] bg-black/[0.035] p-1 lg:flex">
          {NAV_LINKS.map((link) => <a key={link.label} href={link.href} aria-current={isActive(link.href) ? "page" : undefined} className={`relative rounded-[10px] px-4 py-2 text-[13px] font-medium tracking-[-0.01em] transition-all duration-200 ${isActive(link.href) ? "bg-white text-[#151716] shadow-[0_3px_12px_-7px_rgba(0,0,0,.45)]" : "text-[#6d6d67] hover:bg-white/70 hover:text-[#151716]"}`}>{link.label}</a>)}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <a href={LOGIN_URL} className="rounded-[11px] px-4 py-2.5 text-[13px] font-medium text-[#595954] transition-colors hover:bg-black/[0.04] hover:text-[#151716]">Sign in</a>
          <a href={SIGNUP_URL} className="group inline-flex h-10 items-center gap-2.5 rounded-[11px] bg-[#151716] px-4 text-[13px] font-medium text-white shadow-[0_10px_25px_-14px_rgba(0,0,0,.9)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#292b29] active:translate-y-0">Start rendering <span className="transition-transform duration-200 group-hover:translate-x-0.5"><ArrowIcon /></span></a>
        </div>

        <button type="button" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-controls="mobile-navigation" aria-label={menuOpen ? "Close menu" : "Open menu"} className="grid h-10 w-10 place-items-center rounded-[12px] border border-black/[0.08] bg-white/70 text-[#151716] transition-colors hover:bg-white lg:hidden"><MenuIcon open={menuOpen} /></button>
      </div>
    </div>

    <div id="mobile-navigation" className={`fixed inset-x-3 bottom-3 top-[86px] overflow-y-auto rounded-[22px] border border-black/[0.08] bg-[#161817] text-white shadow-[0_30px_80px_-30px_rgba(0,0,0,.75)] transition-all duration-300 sm:inset-x-5 sm:top-[94px] lg:hidden ${menuOpen ? "visible translate-y-0 opacity-100" : "invisible -translate-y-2 opacity-0"}`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(200,100,66,.2),transparent_33%)]" />
      <div className="relative flex h-full flex-col px-6 py-7 sm:px-9 sm:py-9">
        <div className="flex items-center justify-between border-b border-white/10 pb-5">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/45">Navigation index</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#d98a6f]">ArchViz / AI</span>
        </div>
        <nav className="flex flex-1 flex-col justify-center py-5">
          {NAV_LINKS.map((link) => <a key={link.label} href={link.href} onClick={() => setMenuOpen(false)} className="group flex items-baseline justify-between border-b border-white/10 py-4 sm:py-5"><span className="font-display text-[clamp(1.9rem,8vw,3.5rem)] font-medium leading-none tracking-[-0.045em] text-white/90 transition-all duration-200 group-hover:translate-x-2 group-hover:text-white">{link.label}</span><span className="font-mono text-[10px] text-white/35 transition-colors group-hover:text-[#d98a6f]">{link.index}</span></a>)}
        </nav>
        <div className="grid grid-cols-[1fr_1.45fr] gap-3 pt-5">
          <a href={LOGIN_URL} className="grid h-12 place-items-center rounded-[13px] border border-white/15 text-sm font-medium text-white/75 transition-colors hover:bg-white/5 hover:text-white">Sign in</a>
          <a href={SIGNUP_URL} className="group flex h-12 items-center justify-center gap-2.5 rounded-[13px] bg-[#c86442] text-sm font-medium text-white transition-colors hover:bg-[#d27352]">Start rendering <span className="transition-transform group-hover:translate-x-0.5"><ArrowIcon /></span></a>
        </div>
      </div>
    </div>
  </header>;
}
