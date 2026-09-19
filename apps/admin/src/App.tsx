import { useState, type ReactNode } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { SignIn, useAuth, useClerk, UserButton } from "@clerk/react";
import type { LucideIcon } from "lucide-react";
import { ImageIcon, LayoutDashboard, Menu, Settings, ShieldCheck, Sparkles, Users, X } from "lucide-react";
import type { MeResponse } from "@renvia/types";
import { useAdminApi } from "./lib/api";
import { AdminContext } from "./lib/useAdmin";
import { useLoad } from "./lib/useLoad";
import { OverviewPage } from "./pages/OverviewPage";
import { UsersPage } from "./pages/UsersPage";
import { UserDetailPage } from "./pages/UserDetailPage";
import { RendersPage } from "./pages/RendersPage";
import { SettingsPage } from "./pages/SettingsPage";

export default function App() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) return <FullScreen>Loading…</FullScreen>;
  if (!isSignedIn) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-radial px-4">
        <div className="flex flex-col items-center gap-8">
          <Brand tone="light" />
          <SignIn routing="hash" />
        </div>
      </div>
    );
  }
  return <AdminGate />;
}

/**
 * Confirms the signed-in user is an active admin before showing anything. The API
 * enforces the same rule on every /admin request — this gate is only for the UI.
 */
function AdminGate() {
  const api = useAdminApi();
  const { signOut } = useClerk();
  const { data: me, error, reload } = useLoad<MeResponse>(() => api.getMe(), [api]);

  if (error && !me) {
    return (
      <FullScreen>
        <p className="text-sm text-rose-600">Couldn't reach the API: {error}</p>
        <button type="button" onClick={reload} className="mt-3 text-sm font-medium underline">
          Retry
        </button>
      </FullScreen>
    );
  }
  if (!me) return <FullScreen>Checking access…</FullScreen>;
  if (me.role !== "admin" || me.disabled) {
    return (
      <FullScreen>
        <div className="max-w-sm rounded-2xl border border-hairline bg-canvas p-8 text-center shadow-soft">
          <Brand />
          <h1 className="mt-6 text-lg font-semibold">Access denied</h1>
          <p className="mt-2 text-sm text-muted">{me.email} isn't an admin. Sign in with an admin account to continue.</p>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-ink-800"
          >
            Sign out
          </button>
        </div>
      </FullScreen>
    );
  }

  return (
    <AdminContext.Provider value={me}>
      <Layout me={me}>
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/users/:id" element={<UserDetailPage />} />
          <Route path="/renders" element={<RendersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </AdminContext.Provider>
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end: boolean;
  title: string;
}

const NAV: NavItem[] = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true, title: "Overview" },
  { to: "/users", label: "Users", icon: Users, end: false, title: "Users" },
  { to: "/renders", label: "Renders", icon: ImageIcon, end: false, title: "Renders" },
  { to: "/settings", label: "Settings", icon: Settings, end: false, title: "Settings" },
];

function Layout({ me, children }: { me: MeResponse; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const active = [...NAV].reverse().find((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)));

  return (
    <div className="min-h-screen bg-surface lg:flex">
      {/* Mobile backdrop */}
      {open && <div className="fixed inset-0 z-30 bg-ink-950/50 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}

      <Sidebar me={me} open={open} onClose={() => setOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-hairline bg-surface/80 px-4 backdrop-blur-xl sm:px-8">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-xl border border-hairline bg-canvas text-secondary lg:hidden"
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wider text-faint">Renvia Admin</p>
            <h2 className="truncate text-[15px] font-semibold text-primary">{active?.title ?? "Overview"}</h2>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden items-center gap-1.5 rounded-full border border-hairline bg-canvas px-3 py-1.5 text-xs font-medium text-muted shadow-card sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              All systems operational
            </span>
            <div className="lg:hidden">
              <UserButton />
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">
          <div key={location.pathname} className="mx-auto max-w-6xl animate-rise-in">{children}</div>
        </main>
      </div>
    </div>
  );
}

function Sidebar({ me, open, onClose }: { me: MeResponse; open: boolean; onClose: () => void }) {
  return (
    <aside
      className={`ink-scroll fixed inset-y-0 left-0 z-40 flex w-[264px] flex-col overflow-y-auto bg-ink-radial px-4 py-5 transition-transform duration-300 lg:static lg:z-0 lg:translate-x-0 ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      <div className="flex items-center justify-between px-2">
        <Brand tone="light" />
        <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-800 hover:text-white lg:hidden" aria-label="Close menu">
          <X size={18} />
        </button>
      </div>

      <p className="mb-2 mt-8 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">Menu</p>
      <nav className="flex flex-col gap-1" aria-label="Admin sections">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onClose}
            className={({ isActive }) =>
              `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                isActive ? "bg-ink-800 text-white shadow-lift" : "text-ink-300 hover:bg-ink-800/60 hover:text-white"
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-accent-sheen" />}
                <item.icon size={18} strokeWidth={2} className={isActive ? "text-white" : "text-ink-400 group-hover:text-white"} />
                {item.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto space-y-4 pt-6">
        <div className="rounded-2xl border border-ink-700/70 bg-ink-800/50 p-4">
          <div className="flex items-center gap-2 text-white">
            <Sparkles size={15} className="text-glow" />
            <span className="text-xs font-semibold">Admin workspace</span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-300">
            Full control over users, credits and rendering spend.
          </p>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-ink-700/70 bg-ink-850/60 px-3 py-2.5">
          <UserButton
            appearance={{ elements: { avatarBox: "h-8 w-8" } }}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-white">{me.email}</p>
            <p className="flex items-center gap-1 text-[10px] text-ink-400">
              <ShieldCheck size={11} className="text-emerald-400" /> Administrator
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function Brand({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const wordmark = tone === "light" ? "text-white" : "text-primary";
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent-sheen text-white shadow-glow">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
          <path d="M4 20 12 4l8 16M8 20l4-8 4 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className={`flex items-baseline gap-1.5 font-display text-[15px] font-bold uppercase tracking-[0.16em] ${wordmark}`}>
        Renvia
        <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-semibold tracking-normal ${tone === "light" ? "bg-ink-700 text-ink-200" : "bg-surface-muted text-muted"}`}>
          ADMIN
        </span>
      </span>
    </div>
  );
}

function FullScreen({ children }: { children: ReactNode }) {
  return <div className="grid min-h-screen place-items-center bg-surface px-4 text-center text-sm text-muted">{children}</div>;
}
