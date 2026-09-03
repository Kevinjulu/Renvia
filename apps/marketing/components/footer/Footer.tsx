"use client";

import Link from "next/link";
import Image from "next/image";
import { Logo } from "@/components/brand/Logo";
import { SIGNUP_URL } from "@/lib/config";

const FOOTER_LINKS = [
  {
    heading: "Product",
    links: [
      { label: "Studio", href: "#features" },
      { label: "Pricing", href: "#pricing" },
      { label: "What's new", href: "#" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "#" },
      { label: "Careers", href: "#" },
      { label: "Contact", href: "#" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Docs", href: "#" },
      { label: "API", href: "#" },
      { label: "Help center", href: "#" },
    ],
  },
];

function TwitterIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22 5.9c-.7.3-1.5.55-2.3.65a4 4 0 0 0 1.75-2.2c-.78.46-1.64.8-2.56.98a4 4 0 0 0-6.82 3.65A11.35 11.35 0 0 1 3.9 4.6a4 4 0 0 0 1.24 5.34 4 4 0 0 1-1.81-.5v.05a4 4 0 0 0 3.21 3.92 4 4 0 0 1-1.8.07 4 4 0 0 0 3.74 2.78A8.03 8.03 0 0 1 2 18.4a11.32 11.32 0 0 0 6.13 1.8c7.35 0 11.37-6.09 11.37-11.37l-.01-.52A8.1 8.1 0 0 0 22 5.9Z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM.5 21.5h9V8.75h-9V21.5ZM13 8.75V21.5h9v-6.9c0-3.7-2-5.4-4.66-5.4a4.02 4.02 0 0 0-3.64 2v-1.72H13Z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="4.5" strokeWidth="1.6" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function YoutubeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.5 12 4.5 12 4.5s-7 0-8.9.6A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12a31 31 0 0 0 .5 4.8A3 3 0 0 0 3.1 19c1.9.6 8.9.6 8.9.6s7 0 8.9-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 23.5 12a31 31 0 0 0-.5-4.8ZM9.8 15.5V8.5l6 3.5-6 3.5Z" />
    </svg>
  );
}

const SOCIAL_LINKS = [
  { label: "X", href: "#", icon: <TwitterIcon /> },
  { label: "LinkedIn", href: "#", icon: <LinkedInIcon /> },
  { label: "Instagram", href: "#", icon: <InstagramIcon /> },
  { label: "YouTube", href: "#", icon: <YoutubeIcon /> },
];

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CTABanner() {
  return (
    <div className="relative h-64 overflow-hidden rounded-2xl border border-hairline sm:h-72">
      <div className="absolute inset-0 flex">
        <div className="relative h-full w-1/2">
          <Image
            src="/hero/lakeside-house-sketch.png"
            alt="Original architectural drawing, uploaded model"
            fill
            sizes="50vw"
            className="object-cover"
          />
        </div>
        <div className="relative h-full w-1/2">
          <Image
            src="/hero/lakeside-house.jpg"
            alt="Photoreal render of the same house"
            fill
            sizes="50vw"
            className="object-cover"
          />
        </div>
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0)_0%,rgba(255,255,255,0.94)_38%,rgba(255,255,255,0.94)_62%,rgba(255,255,255,0)_100%)]" />

      <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
        <h3 className="font-display text-2xl font-semibold leading-tight text-primary sm:text-3xl">
          See what your model
          <br />
          could become.
        </h3>
        <p className="mt-3 max-w-xs text-sm text-muted">Upload your first project and start exploring.</p>
        <a
          href={SIGNUP_URL}
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          Start rendering
          <ArrowIcon />
        </a>
      </div>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-hairline px-6 py-16">
      <div className="mx-auto max-w-content">
        <CTABanner />

        <div className="mt-14 grid grid-cols-2 gap-10 sm:grid-cols-5 sm:gap-8">
          <div className="col-span-2 sm:col-span-1">
            <Link href="/" aria-label="Renvia home" className="inline-flex items-center">
              <Logo />
            </Link>
            <p className="mt-3 max-w-[26ch] text-sm text-muted">
              AI-powered visualization for architects and designers.
            </p>
            <div className="mt-4 flex gap-4">
              {SOCIAL_LINKS.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  aria-label={link.label}
                  className="text-muted transition-colors hover:text-primary"
                >
                  {link.icon}
                </a>
              ))}
            </div>
          </div>

          {FOOTER_LINKS.map((group) => (
            <div key={group.heading}>
              <p className="text-xs font-medium uppercase tracking-wide text-secondary">{group.heading}</p>
              <ul className="mt-3 flex flex-col gap-2.5">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <a href={link.href} className="text-sm text-primary transition-colors hover:text-secondary">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-secondary">Newsletter</p>
            <p className="mt-3 text-sm text-muted">Get tips, updates, and inspiration straight to your inbox.</p>
            <form
              className="mt-3 flex items-center gap-2 rounded-lg border border-hairline-strong px-3 py-2 transition-colors focus-within:border-primary/30"
              onSubmit={(event) => event.preventDefault()}
            >
              <input
                type="email"
                required
                placeholder="Your email"
                className="w-full bg-transparent text-sm text-primary placeholder:text-faint focus:outline-none"
              />
              <button type="submit" aria-label="Subscribe" className="shrink-0 text-primary transition-opacity hover:opacity-70">
                <ArrowIcon />
              </button>
            </form>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-2 border-t border-hairline pt-6 text-xs text-muted sm:flex-row sm:justify-between">
          <span>© {new Date().getFullYear()} Renvia. All rights reserved.</span>
          <div className="flex gap-4">
            <Link href="/privacy" className="transition-colors hover:text-primary">
              Privacy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-primary">
              Terms
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
