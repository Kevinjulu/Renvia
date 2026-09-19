import type { ReactNode } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { SignIn, useAuth, useClerk, UserButton } from "@clerk/react";
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
      <FullScreen>
        <div className="flex flex-col items-center gap-6">
          <Brand />
          <SignIn routing="hash" />
        </div>
      </FullScreen>
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
        <p className="text-sm text-red-600">Couldn't reach the API: {error}</p>
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
        <div className="max-w-sm text-center">
          <Brand />
          <h1 className="mt-6 text-lg font-semibold">Access denied</h1>
          <p className="mt-2 text-sm text-muted">{me.email} isn't an admin. Sign in with an admin account to continue.</p>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Sign out
          </button>
        </div>
      </FullScreen>
    );
  }

  return (
    <AdminContext.Provider value={me}>
      <Layout>
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

const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/users", label: "Users", end: false },
  { to: "/renders", label: "Renders", end: false },
  { to: "/settings", label: "Settings", end: false },
];

function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-hairline bg-canvas md:sticky md:top-0 md:flex md:h-screen md:w-56 md:shrink-0 md:flex-col md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-5 py-4 md:block">
          <Brand />
          <div className="md:hidden">
            <UserButton />
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0" aria-label="Admin sections">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive ? "bg-blueprint-soft text-blueprint" : "text-secondary hover:bg-surface-muted hover:text-primary"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto hidden items-center gap-3 border-t border-hairline px-5 py-4 md:flex">
          <UserButton />
          <span className="text-xs text-muted">Signed in as admin</span>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}

function Brand() {
  return (
    <p className="text-sm font-semibold tracking-tight text-primary">
      Renvia <span className="font-normal text-muted">Admin</span>
    </p>
  );
}

function FullScreen({ children }: { children: ReactNode }) {
  return <div className="grid min-h-screen place-items-center px-4 text-sm text-muted">{children}</div>;
}
