import type { LucideIcon } from "lucide-react";
import type { UserRole } from "@renvia/types";
import { CreditCard, FolderKanban, ImageIcon, LayoutDashboard, Scan, ScrollText, Settings, ShieldAlert, Users, Wallet, ChartNoAxesCombined, ListTodo } from "lucide-react";

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

/** Single source of truth for sidebar + page heroes across the eight tabs. */
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
    to: "/operations", label: "My queue", icon: ListTodo, end: false, title: "Operator queue", description: "Your assigned incidents, pending approvals, and recently failed work.", hint: "Assigned work & approvals", banner: "/banners/exterior-3.jpg", roles: ["analyst", "support", "billing", "admin"],
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
