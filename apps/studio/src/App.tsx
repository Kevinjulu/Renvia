import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { LoginRoute } from "./routes/LoginRoute";
import { SignupRoute } from "./routes/SignupRoute";
import { ForgotPasswordRoute } from "./routes/ForgotPasswordRoute";
import { SsoCallbackRoute } from "./routes/SsoCallbackRoute";
import { DashboardRoute } from "./routes/DashboardRoute";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { AppErrorHandling } from "./components/AppErrorHandling";
import { AppLoader } from "./components/loading/AppLoader";

// The canvas pulls in Konva, so it (and the less-visited pages) load on demand.
const CanvasRoute = lazy(() => import("./routes/CanvasRoute").then((module) => ({ default: module.CanvasRoute })));
const HelpArticleRoute = lazy(() => import("./routes/HelpArticleRoute").then((module) => ({ default: module.HelpArticleRoute })));
const DashboardSectionRoute = lazy(() =>
  import("./routes/DashboardSectionRoute").then((module) => ({ default: module.DashboardSectionRoute })),
);

export default function App() {
  return (
    <BrowserRouter>
      <AppErrorHandling app="studio">
      <Suspense fallback={<AppLoader />}>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/signup" element={<SignupRoute />} />
        <Route path="/forgot-password" element={<ForgotPasswordRoute />} />
        <Route path="/sso-callback/*" element={<SsoCallbackRoute />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<DashboardRoute />} />
          <Route path="/project/:projectId" element={<CanvasRoute />} />
          <Route path="/help/:slug" element={<HelpArticleRoute />} />
          <Route path="/explore" element={<DashboardSectionRoute section="explore" />} />
          <Route path="/templates" element={<DashboardSectionRoute section="templates" />} />
          <Route path="/assets" element={<DashboardSectionRoute section="assets" />} />
          <Route path="/ai-tools" element={<DashboardSectionRoute section="ai-tools" />} />
          <Route path="/team" element={<DashboardSectionRoute section="team" />} />
          <Route path="/settings" element={<DashboardSectionRoute section="settings" />} />
          <Route path="/billing" element={<DashboardSectionRoute section="billing" />} />
          <Route path="/activity" element={<DashboardSectionRoute section="activity" />} />
        </Route>
      </Routes>
      </Suspense>
      </AppErrorHandling>
    </BrowserRouter>
  );
}
