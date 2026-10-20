import type { LucideIcon } from "lucide-react";
import type { UserRole } from "@renvia/types";
import { ShieldCheck, FlaskConical, Images, MessageSquareWarning, ClipboardCheck, CreditCard, FolderKanban, ImageIcon, LayoutDashboard, Scan, ScrollText, Settings, ShieldAlert, Users, Wallet, ChartNoAxesCombined, Gauge, SlidersHorizontal, BadgeDollarSign, Cpu } from "lucide-react";

export interface AdminNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end: boolean;
  /** Short title for the top bar and document context. */
  title: string;
  /** One-line blurb under the title — what this tab is for. */
  description: string;
  /** Even shorter hint under the sidebar label. */
  hint: string;
  /** Banner image in /banners (served from admin public). */
  banner: string;
  roles: readonly Exclude<UserRole, "user">[];
}

/**
 * Sidebar sections, in order. Each page appears in exactly one; anything missing from here lands in
 * a trailing "More" section so a new page can never silently vanish from the menu.
 */
export const ADMIN_NAV_GROUPS: { label: string; paths: string[] }[] = [
  { label: "Monitor", paths: ["/", "/incidents", "/performance"] },
  { label: "Customers", paths: ["/users", "/projects", "/credits", "/security"] },
  { label: "Studio jobs", paths: ["/renders", "/segmentations"] },
  { label: "Revenue", paths: ["/billing", "/plans"] },
  { label: "Beta", paths: ["/beta"] },
  { label: "Governance", paths: ["/approvals", "/audit"] },
  // Settings closes the menu: it is the broadest control, so it comes last.
  { label: "Platform", paths: ["/studio-control", "/models", "/library", "/settings"] },
];

/**
 * Pages that share one sidebar entry and a tab bar. The first tab is where the entry links; every
 * tab keeps its own route, so existing links and bookmarks still work.
 */
export const ADMIN_NAV_HUBS: { label: string; tabs: { to: string; label: string }[] }[] = [
  { label: "Revenue", tabs: [{ to: "/billing", label: "Payments & billing" }, { to: "/financials", label: "Financials" }] },
  { label: "Beta", tabs: [{ to: "/beta", label: "Programs" }, { to: "/beta-feedback", label: "Tester feedback" }] },
];

/** The hub a path belongs to, if any. */
export function hubForPath(pathname: string) {
  return ADMIN_NAV_HUBS.find((hub) => hub.tabs.some((tab) => pathname === tab.to || pathname.startsWith(`${tab.to}/`)));
}

/** Single source of truth for sidebar + page heroes across every tab. */
export const ADMIN_NAV: AdminNavItem[] = [
  {
    to: "/",
    label: "Overview",
    icon: LayoutDashboard,
    end: true,
    title: "Overview",
    description: "Live pulse of usage, fal spend, and pipeline health — start here when something looks off.",
    hint: "Health & spend at a glance",
    banner: "/banners/exterior-1.jpg",
    roles: ["analyst", "support", "billing", "admin"],
  },
  {
    to: "/users",
    label: "Users",
    icon: Users,
    end: false,
    title: "Users",
    description: "Accounts, credits, roles, and access — promote admins, disable accounts, and top up balances.",
    hint: "Roles, credits, access",
    banner: "/banners/community.jpg",
    roles: ["support", "billing", "admin"],
  },
  {
    to: "/projects",
    label: "Projects",
    icon: FolderKanban,
    end: false,
    title: "Projects",
    description: "Every studio workspace with its owner, spend, and render health — open one to inspect activity.",
    hint: "Workspaces & owners",
    banner: "/banners/cabin.jpg",
    roles: ["analyst", "support", "admin"],
  },
  {
    to: "/renders",
    label: "Renders",
    icon: ImageIcon,
    end: false,
    title: "Renders",
    description: "Triage the generation pipeline — stuck jobs, failures, model cost, and full job detail.",
    hint: "Jobs, failures, stuck",
    banner: "/banners/elevation.jpg",
    roles: ["analyst", "support", "admin"],
  },
  {
    to: "/segmentations",
    label: "Segmentations",
    icon: Scan,
    end: false,
    title: "Segmentations",
    description: "Automatic selections from Auto select — prompts, clicks, masks, and SAM spend.",
    hint: "Auto-select masks",
    banner: "/banners/exterior-2.jpg",
    roles: ["analyst", "support", "admin"],
  },
  {
    to: "/credits",
    label: "Credits",
    icon: Wallet,
    end: false,
    title: "Credits",
    description: "The ledger of every grant, charge, and refund — what’s outstanding and what flowed through.",
    hint: "Grants, charges, refunds",
    banner: "/banners/lakeside.jpg",
    roles: ["analyst", "billing", "admin"],
  },
  {
    to: "/billing",
    label: "Billing",
    icon: CreditCard,
    end: false,
    title: "Billing operations",
    description: "Payments, active plans, and signed provider-webhook delivery health.",
    hint: "Revenue & PayPal events",
    banner: "/banners/lakeside.jpg",
    roles: ["billing", "admin"],
  },
  {
    to: "/financials", label: "Financials", icon: ChartNoAxesCombined, end: false, title: "Financial truth", description: "Confirmed provider revenue alongside estimated FAL cost, margins, burn, and runway.", hint: "Revenue, cost & runway", banner: "/banners/lakeside.jpg", roles: ["billing", "admin"],
  },
  {
    to: "/performance",
    label: "Performance",
    icon: Gauge,
    end: false,
    title: "Performance",
    description: "How fast and how reliably jobs finish — latency by job type and model, failure groups, and cost per result.",
    hint: "Latency, failures, cost",
    banner: "/banners/elevation.jpg",
    roles: ["analyst", "support", "admin"],
  },
  {
    to: "/incidents",
    label: "Incidents",
    icon: ShieldAlert,
    end: false,
    title: "Incident center",
    description: "Assign, acknowledge, recover, and resolve failed operational work with a durable response trail.",
    hint: "Failures and recovery",
    banner: "/banners/exterior-3.jpg",
    roles: ["support", "billing", "admin"],
  },
  {
    to: "/beta",
    label: "Beta program",
    icon: FlaskConical,
    end: false,
    title: "Beta program",
    description: "Private testing programs: testers, invitations, credits, missions, announcements and the fal budget.",
    hint: "Testers, credits & budget",
    banner: "/banners/cabin.jpg",
    roles: ["analyst", "support", "billing", "admin"],
  },
  {
    to: "/beta-feedback",
    label: "Beta feedback",
    icon: MessageSquareWarning,
    end: false,
    title: "Beta feedback",
    description: "Every tester report with their marks on the render, diagnostics and thread — triage, reply and resolve.",
    hint: "Tester reports & triage",
    banner: "/banners/exterior-2.jpg",
    roles: ["analyst", "support", "billing", "admin"],
  },
  {
    to: "/approvals",
    label: "Approvals",
    icon: ClipboardCheck,
    end: false,
    title: "Approvals",
    description: "High-risk actions held for a second administrator — approve, reject, then execute.",
    hint: "Second-admin sign-off",
    banner: "/banners/exterior-1.jpg",
    roles: ["billing", "admin"],
  },
  {
    to: "/audit",
    label: "Audit",
    icon: ScrollText,
    end: false,
    title: "Audit",
    description: "A permanent trail of operator actions — credit grants, role changes, and settings updates.",
    hint: "Who changed what",
    banner: "/banners/exterior-3.jpg",
    roles: ["analyst", "billing", "admin"],
  },
  {
    to: "/plans",
    label: "Plans & Pricing",
    icon: BadgeDollarSign,
    end: false,
    title: "Plans & Pricing",
    description: "Credit prices, plan terms and credit packs — every change versioned — plus a simulator for what a pricing change would mean.",
    hint: "Prices, plans, packs",
    banner: "/banners/lakeside.jpg",
    roles: ["billing", "admin"],
  },
  {
    to: "/models",
    label: "Model Registry",
    icon: Cpu,
    end: false,
    title: "Model Registry",
    description: "The AI models behind each Studio route — cost, reliability and speed — and a switch to pause a failing one.",
    hint: "Models, routing, holds",
    banner: "/banners/exterior-2.jpg",
    roles: ["analyst", "support", "admin"],
  },
  {
    to: "/studio-control",
    label: "Studio Control",
    icon: SlidersHorizontal,
    end: false,
    title: "Studio Control",
    description: "Switch Studio features on or off, limit them to plans, roll them out gradually, and schedule maintenance — versioned, with rollback.",
    hint: "Features & maintenance",
    banner: "/banners/elevation.jpg",
    roles: ["analyst", "support", "admin"],
  },
  {
    to: "/library",
    label: "Reference library",
    icon: Images,
    end: false,
    title: "Reference library",
    description: "Sample images every Studio user can pick as a reference: windows, roofs, doors, pillars, outdoors and exteriors.",
    hint: "Sample references for users",
    banner: "/banners/elevation.jpg",
    roles: ["admin"],
  },
  {
    to: "/security",
    label: "Security",
    icon: ShieldCheck,
    end: false,
    title: "Security",
    description: "How the free-credit checks are working, and the accounts waiting on a decision. Decide each one on its user page.",
    hint: "Free-credit checks & review",
    banner: "/banners/exterior-3.jpg",
    roles: ["analyst", "support", "billing", "admin"],
  },
  {
    to: "/settings",
    label: "Settings",
    icon: Settings,
    end: false,
    title: "Settings",
    description: "Live ops controls — engine mode, budgets, limits, maintenance, and alerts. No redeploy needed.",
    hint: "Mode, budget, limits",
    banner: "/banners/exterior-1.jpg",
    roles: ["admin"],
  },
];

export function navForPath(pathname: string): AdminNavItem {
  return (
    [...ADMIN_NAV].reverse().find((item) => (item.end ? pathname === item.to : pathname.startsWith(item.to))) ??
    ADMIN_NAV[0]!
  );
}
