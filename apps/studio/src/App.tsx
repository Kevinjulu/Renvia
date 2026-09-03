import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { LoginRoute } from "./routes/LoginRoute";
import { SignupRoute } from "./routes/SignupRoute";
import { ForgotPasswordRoute } from "./routes/ForgotPasswordRoute";
import { SsoCallbackRoute } from "./routes/SsoCallbackRoute";
import { DashboardRoute } from "./routes/DashboardRoute";
import { CanvasRoute } from "./routes/CanvasRoute";
import { HelpArticleRoute } from "./routes/HelpArticleRoute";
import { ProtectedRoute } from "./routes/ProtectedRoute";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/signup" element={<SignupRoute />} />
        <Route path="/forgot-password" element={<ForgotPasswordRoute />} />
        <Route path="/sso-callback" element={<SsoCallbackRoute />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<DashboardRoute />} />
          <Route path="/project/:projectId" element={<CanvasRoute />} />
          <Route path="/help/:slug" element={<HelpArticleRoute />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
