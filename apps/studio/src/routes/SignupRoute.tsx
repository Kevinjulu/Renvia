import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth, useSignUp } from "@clerk/react";
import { AuthLayout } from "../components/auth/AuthLayout";
import { FormField } from "../components/auth/FormField";
import { AuthButton } from "../components/auth/AuthButton";
import { AuthAlert } from "../components/auth/AuthAlert";
import { CodeInput } from "../components/auth/CodeInput";
import { ResendCode } from "../components/auth/ResendCode";
import { SocialButtons, AuthDivider, type SocialStrategy } from "../components/auth/SocialButtons";
import { BackLink } from "../components/auth/BackLink";
import { StepProgress } from "../components/auth/StepProgress";
import { PasswordStrength } from "../components/auth/PasswordStrength";
import { TermsCheckbox } from "../components/auth/TermsCheckbox";

type Step = "details" | "verify";

export function SignupRoute() {
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { signUp, errors, fetchStatus } = useSignUp();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("details");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  if (authLoaded && isSignedIn) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleDetailsSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setStatusNote(null);

    const { error } = await signUp.password({ emailAddress: email, password });
    if (error) return;

    const { error: codeError } = await signUp.verifications.sendEmailCode();
    if (codeError) return;

    setStep("verify");
  };

  const handleVerifySubmit = async (event: FormEvent) => {
    event.preventDefault();
    setStatusNote(null);

    const { error } = await signUp.verifications.verifyEmailCode({ code });
    if (error) return;

    if (signUp.status === "complete") {
      await signUp.finalize();
      navigate("/dashboard");
    } else {
      setStatusNote("That code didn't complete your account. Please try again.");
    }
  };

  const submitting = fetchStatus === "fetching";
  const globalError = errors.global?.[0];

  const handleSocial = async (strategy: SocialStrategy) => {
    await signUp.sso({ strategy, redirectUrl: "/sso-callback", redirectCallbackUrl: "/sso-callback" });
  };

  return (
    <AuthLayout
      image="/auth/sign-up.jpg"
      label="Site — 02 / Sign up"
      title="From sketch to photoreal in one sitting."
      description="No render farm, no plugins — upload a model and get material-accurate output before your coffee's cold."
      accent="glow"
      stat={{ label: "Render time", value: "4K in under a minute" }}
    >
      <StepProgress steps={["Account", "Verify"]} currentIndex={step === "details" ? 0 : 1} accent="glow" />

      {step === "details" ? (
        <>
          <h1 className="font-display text-2xl font-semibold text-primary">Create your account</h1>
          <p className="mt-2 text-sm text-muted">Start rendering with Renvia Studio.</p>

          <div className="mt-8 flex flex-col gap-5">
            <SocialButtons onSelect={(strategy) => void handleSocial(strategy)} disabled={submitting} />
            <AuthDivider />
          </div>

          <form onSubmit={(event) => void handleDetailsSubmit(event)} className="mt-5 flex flex-col gap-5">
            <FormField
              label="Email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={errors.fields.emailAddress?.message}
            />
            <div className="flex flex-col gap-2">
              <FormField
                label="Password"
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

            <TermsCheckbox checked={agreedToTerms} onChange={setAgreedToTerms} />

            {globalError && <AuthAlert>{globalError.longMessage ?? globalError.message}</AuthAlert>}

            <AuthButton loading={submitting} loadingLabel="Creating account…">
              Continue
            </AuthButton>
          </form>
        </>
      ) : (
        <>
          <BackLink onClick={() => setStep("details")}>Back</BackLink>
          <h1 className="font-display text-2xl font-semibold text-primary">Check your email</h1>
          <p className="mt-2 text-sm text-muted">Enter the 6-digit code we sent to {email}.</p>

          <form onSubmit={(event) => void handleVerifySubmit(event)} className="mt-8 flex flex-col gap-5">
            <CodeInput value={code} onChange={setCode} error={errors.fields.code?.message} autoFocus />

            {(globalError || statusNote) && (
              <AuthAlert>{globalError?.longMessage ?? globalError?.message ?? statusNote}</AuthAlert>
            )}

            <AuthButton loading={submitting} loadingLabel="Verifying…">
              Continue
            </AuthButton>

            <ResendCode onResend={() => signUp.verifications.sendEmailCode()} />
          </form>
        </>
      )}

      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <a href="/login" className="font-medium text-primary hover:opacity-80">
          Sign in
        </a>
      </p>
    </AuthLayout>
  );
}
