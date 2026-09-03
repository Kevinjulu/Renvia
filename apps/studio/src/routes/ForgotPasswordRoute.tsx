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
import { StepProgress } from "../components/auth/StepProgress";
import { PasswordStrength } from "../components/auth/PasswordStrength";

type Step = "request" | "reset";

export function ForgotPasswordRoute() {
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { signIn, errors, fetchStatus } = useSignIn();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [statusNote, setStatusNote] = useState<string | null>(null);

  if (authLoaded && isSignedIn) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleRequestSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setStatusNote(null);

    const { error } = await signIn.create({ identifier: email });
    if (error) return;

    const { error: codeError } = await signIn.resetPasswordEmailCode.sendCode();
    if (codeError) return;

    setStep("reset");
  };

  const handleResetSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setStatusNote(null);

    const { error } = await signIn.resetPasswordEmailCode.verifyCode({ code });
    if (error) return;

    const { error: submitError } = await signIn.resetPasswordEmailCode.submitPassword({ password });
    if (submitError) return;

    if (signIn.status === "complete") {
      await signIn.finalize();
      navigate("/dashboard");
    } else {
      setStatusNote("Couldn't complete the reset. Please try again.");
    }
  };

  const submitting = fetchStatus === "fetching";
  const globalError = errors.global?.[0];

  return (
    <AuthLayout
      image="/auth/forgot-password.jpg"
      label="Site — 03 / Reset access"
      title="Locked out, not locked geometry."
      description="Your renders, revisions, and material presets are exactly where you left them."
      accent="blueprint"
      stat={{ label: "Preserved", value: "Projects, revisions, presets" }}
    >
      <StepProgress steps={["Request", "Reset"]} currentIndex={step === "request" ? 0 : 1} accent="blueprint" />

      {step === "request" ? (
        <>
          <h1 className="font-display text-2xl font-semibold text-primary">Reset your password</h1>
          <p className="mt-2 text-sm text-muted">Enter your email and we&apos;ll send you a reset code.</p>

          <form onSubmit={(event) => void handleRequestSubmit(event)} className="mt-8 flex flex-col gap-5">
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

            {globalError && <AuthAlert>{globalError.longMessage ?? globalError.message}</AuthAlert>}

            <AuthButton loading={submitting} loadingLabel="Sending code…">
              Send reset code
            </AuthButton>
          </form>
        </>
      ) : (
        <>
          <BackLink onClick={() => setStep("request")}>Back</BackLink>
          <h1 className="font-display text-2xl font-semibold text-primary">Set a new password</h1>
          <p className="mt-2 text-sm text-muted">Enter the code sent to {email} and choose a new password.</p>

          <form onSubmit={(event) => void handleResetSubmit(event)} className="mt-8 flex flex-col gap-5">
            <CodeInput value={code} onChange={setCode} error={errors.fields.code?.message} autoFocus />
            <div className="flex flex-col gap-2">
              <FormField
                label="New password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                error={errors.fields.password?.message}
              />
              <PasswordStrength password={password} />
            </div>

            {(globalError || statusNote) && (
              <AuthAlert>{globalError?.longMessage ?? globalError?.message ?? statusNote}</AuthAlert>
            )}

            <AuthButton loading={submitting} loadingLabel="Resetting…">
              Reset password
            </AuthButton>

            <ResendCode onResend={() => signIn.resetPasswordEmailCode.sendCode()} />
          </form>
        </>
      )}

      <p className="mt-6 text-center text-sm text-muted">
        Remembered it?{" "}
        <a href="/login" className="font-medium text-primary hover:opacity-80">
          Sign in
        </a>
      </p>
    </AuthLayout>
  );
}
