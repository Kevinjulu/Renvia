import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { SignIn, useAuth, useClerk, UserButton } from "@clerk/react";
import { Menu, X } from "lucide-react";
import type { MeResponse } from "@renvia/types";
import { Logo } from "./components/brand/Logo";
import { AppLoader } from "./components/loading/AppLoader";
import { useAdminApi } from "./lib/api";
import { ADMIN_NAV, navForPath } from "./lib/nav";
import { AdminContext } from "./lib/useAdmin";
import { useLoad } from "./lib/useLoad";
import { OverviewPage } from "./pages/OverviewPage";
import { UsersPage } from "./pages/UsersPage";
import { UserDetailPage } from "./pages/UserDetailPage";
import { RendersPage } from "./pages/RendersPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { CreditsPage } from "./pages/CreditsPage";
import { SegmentationsPage } from "./pages/SegmentationsPage";
import { AuditPage } from "./pages/AuditPage";
import { SettingsPage } from "./pages/SettingsPage";

export default function App() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) return <AppLoader message="Preparing admin" />;
  if (!isSignedIn) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-radial px-4">
        <div className="flex flex-col items-center gap-8">
          <Logo wordmarkClassName="text-xl text-white" />
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
  if (!me) return <AppLoader message="Checking access" />;
  if (me.role !== "admin" || me.disabled) {
    return (
      <FullScreen>
        <div className="max-w-sm rounded-2xl border border-hairline bg-canvas p-8 text-center shadow-soft">
          <Logo />
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
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/renders" element={<RendersPage />} />
          <Route path="/segmentations" element={<SegmentationsPage />} />
          <Route path="/credits" element={<CreditsPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </AdminContext.Provider>
  );
}

function Layout({ me, children }: { me: MeResponse; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const active = navForPath(location.pathname);

  useEffect(() => {
    document.title = `${active.title} · Renvia Admin`;
  }, [active.title]);

  return (
    <div className="min-h-screen bg-surface lg:flex">
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
            <h2 className="truncate text-[15px] font-semibold text-primary">{active.title}</h2>
          </div>
          <div className="ml-auto flex items-center gap-3 lg:hidden">
            <UserButton />
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
      className={`ink-scroll fixed left-0 top-0 z-40 flex h-screen w-[280px] shrink-0 flex-col overflow-y-auto bg-ink-950 transition-transform duration-300 lg:sticky lg:z-0 lg:translate-x-0 ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      {/* Photo header */}
      <div className="relative shrink-0 overflow-hidden">
        <img src="/banners/exterior-2.jpg" alt="" className="h-36 w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-ink-950/30 via-ink-950/55 to-ink-950" />
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-4">
          <Logo wordmarkClassName="text-[15px] text-white tracking-[0.22em]" />
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white lg:hidden"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>
        <div className="absolute inset-x-0 bottom-0 px-5 pb-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">Operator console</p>
          <p className="mt-1 text-sm font-medium text-white">Workspace control</p>
        </div>
      </div>

      <p className="mb-2 mt-5 px-5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">Navigate</p>
      <nav className="flex flex-1 flex-col gap-0.5 px-3 pb-4" aria-label="Admin sections">
        {ADMIN_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onClose}
            className={({ isActive }) =>
              `group relative flex items-start gap-3 rounded-xl px-3 py-2.5 transition ${
                isActive ? "bg-ink-800 text-white shadow-lift" : "text-ink-300 hover:bg-ink-800/55 hover:text-white"
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-accent-sheen" />}
                <item.icon
                  size={18}
                  strokeWidth={2}
                  className={`mt-0.5 shrink-0 ${isActive ? "text-white" : "text-ink-400 group-hover:text-white"}`}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-tight">{item.label}</span>
                  <span className={`mt-0.5 block text-[11px] leading-snug ${isActive ? "text-ink-300" : "text-ink-500 group-hover:text-ink-400"}`}>
                    {item.hint}
                  </span>
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto border-t border-ink-800 bg-ink-950/80 p-4">
        <div className="flex items-center gap-3 rounded-xl border border-ink-700/80 bg-ink-900/80 px-3 py-2.5">
          <UserButton appearance={{ elements: { avatarBox: "h-8 w-8" } }} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-white">{me.email}</p>
            <p className="text-[10px] text-ink-400">Signed in as admin</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function FullScreen({ children }: { children: ReactNode }) {
  return <div className="grid min-h-screen place-items-center bg-surface px-4 text-center text-sm text-muted">{children}</div>;
}
