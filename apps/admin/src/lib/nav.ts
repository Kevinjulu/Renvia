import type { LucideIcon } from "lucide-react";
import { FolderKanban, ImageIcon, LayoutDashboard, Scan, ScrollText, Settings, Users, Wallet } from "lucide-react";

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
  },
];

export function navForPath(pathname: string): AdminNavItem {
  return (
    [...ADMIN_NAV].reverse().find((item) => (item.end ? pathname === item.to : pathname.startsWith(item.to))) ??
    ADMIN_NAV[0]!
  );
}
