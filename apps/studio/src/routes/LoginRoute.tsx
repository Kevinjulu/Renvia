import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth, useSignIn } from "@clerk/react";
import { AuthLayout } from "../components/auth/AuthLayout";
import { FormField } from "../components/auth/FormField";
import { AuthButton } from "../components/auth/AuthButton";
import { AuthAlert } from "../components/auth/AuthAlert";
import { SocialButtons, AuthDivider, type SocialStrategy } from "../components/auth/SocialButtons";

export function LoginRoute() {
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { signIn, errors, fetchStatus } = useSignIn();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [statusNote, setStatusNote] = useState<string | null>(null);

  if (authLoaded && isSignedIn) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setStatusNote(null);

    const { error } = await signIn.password({ emailAddress: email, password });
    if (error) return;

    if (signIn.status === "complete") {
      await signIn.finalize();
      navigate("/dashboard");
    } else {
      setStatusNote("Additional verification is required for this account.");
    }
  };

  const submitting = fetchStatus === "fetching";
  const globalError = errors.global?.[0];

  const handleSocial = async (strategy: SocialStrategy) => {
    await signIn.sso({ strategy, redirectUrl: "/sso-callback", redirectCallbackUrl: "/sso-callback" });
  };

  return (
    <AuthLayout
      image="/auth/sign-in.jpg"
      label="Site — 01 / Sign in"
      title="Your geometry, exactly as you left it."
      description="Every project, every variation — locked and waiting."
      accent="blueprint"
      stat={{ label: "Autosaved", value: "Every change, continuously" }}
    >
      <h1 className="font-display text-2xl font-semibold text-primary">Sign in</h1>
      <p className="mt-2 text-sm text-muted">Welcome back to Renvia Studio.</p>

      <div className="mt-8 flex flex-col gap-5">
        <SocialButtons onSelect={(strategy) => void handleSocial(strategy)} disabled={submitting} />
        <AuthDivider />
      </div>

      <form onSubmit={(event) => void handleSubmit(event)} className="mt-5 flex flex-col gap-5">
        <FormField
          label="Email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={errors.fields.identifier?.message}
        />
        <FormField
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={errors.fields.password?.message}
          labelAction={
            <a href="/forgot-password" className="text-xs text-blueprint hover:opacity-80">
              Forgot password?
            </a>
          }
        />

        {(globalError || statusNote) && <AuthAlert>{globalError?.longMessage ?? globalError?.message ?? statusNote}</AuthAlert>}

        <AuthButton loading={submitting} loadingLabel="Signing in…">
          Sign in
        </AuthButton>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        Don&apos;t have an account?{" "}
        <a href="/signup" className="font-medium text-primary hover:opacity-80">
          Sign up
        </a>
      </p>
    </AuthLayout>
  );
}
