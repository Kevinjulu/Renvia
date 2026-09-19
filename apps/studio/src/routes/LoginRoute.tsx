import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth, useSignIn } from "@clerk/react";
import { AuthLayout } from "../components/auth/AuthLayout";
import { FormField } from "../components/auth/FormField";
import { AuthButton } from "../components/auth/AuthButton";
import { AuthAlert } from "../components/auth/AuthAlert";
import { CodeInput } from "../components/auth/CodeInput";
import { ResendCode } from "../components/auth/ResendCode";
import { BackLink } from "../components/auth/BackLink";
import { SocialButtons, AuthDivider, type SocialStrategy } from "../components/auth/SocialButtons";
import { AUTH_ROUTES } from "../lib/authRoutes";
import { finishAuth } from "../lib/finishAuth";

/** Second-step strategies this page can complete, in order of preference. */
type VerifyStrategy = "email_code" | "phone_code" | "totp";
const VERIFY_STRATEGIES: VerifyStrategy[] = ["email_code", "phone_code", "totp"];

interface VerifyStep {
  strategy: VerifyStrategy;
  /** Masked email/phone the code went to, when there is one. */
  destination: string | null;
  /** Clerk asks new browsers/devices to confirm by email ("client trust"). */
  newDevice: boolean;
}

export function LoginRoute() {
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { signIn, errors, fetchStatus } = useSignIn();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [verifyStep, setVerifyStep] = useState<VerifyStep | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  if (authLoaded && isSignedIn) {
    return <Navigate to={AUTH_ROUTES.afterAuth} replace />;
  }

  const sendCode = (strategy: VerifyStrategy) => {
    if (strategy === "email_code") return signIn.mfa.sendEmailCode();
    if (strategy === "phone_code") return signIn.mfa.sendPhoneCode();
    return Promise.resolve({ error: null });
  };

  const handlePasswordSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setStatusNote(null);

    const { error } = await signIn.password({ emailAddress: email, password });
    if (error) return;

    if (signIn.status === "complete") {
      await finishAuth(signIn, navigate);
      return;
    }

    if (signIn.status === "needs_client_trust" || signIn.status === "needs_second_factor") {
      const factor = VERIFY_STRATEGIES.map((strategy) =>
        signIn.supportedSecondFactors.find((candidate) => candidate.strategy === strategy),
      ).find(Boolean);
      if (!factor) {
        setStatusNote("This account needs a verification method this page doesn't support yet. Contact support.");
        return;
      }
      const strategy = factor.strategy as VerifyStrategy;
      const { error: sendError } = await sendCode(strategy);
      if (sendError) return;
      setCode("");
      setVerifyStep({
        strategy,
        destination: "safeIdentifier" in factor ? (factor.safeIdentifier ?? null) : null,
        newDevice: signIn.status === "needs_client_trust",
      });
      return;
    }

    setStatusNote("We couldn't finish signing you in. Please try again or reset your password.");
  };

  const handleVerifySubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!verifyStep) return;
    setStatusNote(null);

    const verify = {
      email_code: () => signIn.mfa.verifyEmailCode({ code }),
      phone_code: () => signIn.mfa.verifyPhoneCode({ code }),
      totp: () => signIn.mfa.verifyTOTP({ code }),
    }[verifyStep.strategy];
    const { error } = await verify();
    if (error) return;

    if (signIn.status === "complete") {
      await finishAuth(signIn, navigate);
    } else {
      setStatusNote("That code didn't complete sign-in. Please try again.");
    }
  };

  const handleBack = () => {
    void signIn.reset();
    setVerifyStep(null);
    setCode("");
    setStatusNote(null);
  };

  const submitting = fetchStatus === "fetching";
  const globalError = errors.global?.[0];
  const alert = globalError?.longMessage ?? globalError?.message ?? statusNote;

  const handleSocial = async (strategy: SocialStrategy) => {
    await signIn.sso({
      strategy,
      redirectUrl: AUTH_ROUTES.afterAuth,
      redirectCallbackUrl: AUTH_ROUTES.ssoCallback,
    });
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
      {verifyStep ? (
        <>
          <BackLink onClick={handleBack}>Back</BackLink>
          <h1 className="font-display text-2xl font-semibold text-primary">
            {verifyStep.newDevice ? "Confirm it's you" : "Two-step verification"}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {verifyStep.strategy === "totp"
              ? "Enter the 6-digit code from your authenticator app."
              : `${verifyStep.newDevice ? "You're signing in from a new browser. " : ""}Enter the 6-digit code we sent to ${
                  verifyStep.destination ?? "you"
                }.`}
          </p>

          <form onSubmit={(event) => void handleVerifySubmit(event)} className="mt-8 flex flex-col gap-5">
            <CodeInput value={code} onChange={setCode} error={errors.fields.code?.message} autoFocus />

            {alert && <AuthAlert>{alert}</AuthAlert>}

            <AuthButton loading={submitting} loadingLabel="Verifying…">
              Continue
            </AuthButton>

            {verifyStep.strategy !== "totp" && <ResendCode onResend={() => sendCode(verifyStep.strategy)} />}
          </form>
        </>
      ) : (
        <>
          <h1 className="font-display text-2xl font-semibold text-primary">Sign in</h1>
          <p className="mt-2 text-sm text-muted">Welcome back to Renvia Studio.</p>

          <div className="mt-8 flex flex-col gap-5">
            <SocialButtons onSelect={(strategy) => void handleSocial(strategy)} disabled={submitting} />
            <AuthDivider />
          </div>

          <form onSubmit={(event) => void handlePasswordSubmit(event)} className="mt-5 flex flex-col gap-5">
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

            {alert && <AuthAlert>{alert}</AuthAlert>}

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
        </>
      )}
    </AuthLayout>
  );
}
