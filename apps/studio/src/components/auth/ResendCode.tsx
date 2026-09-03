import { useEffect, useState } from "react";

interface ResendCodeProps {
  onResend: () => Promise<unknown> | unknown;
  cooldownSeconds?: number;
}

export function ResendCode({ onResend, cooldownSeconds = 30 }: ResendCodeProps) {
  const [secondsLeft, setSecondsLeft] = useState(cooldownSeconds);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  const handleResend = async () => {
    setSending(true);
    await onResend();
    setSending(false);
    setSecondsLeft(cooldownSeconds);
  };

  return (
    <p className="text-xs text-muted">
      Didn&apos;t get a code?{" "}
      {secondsLeft > 0 ? (
        <span className="text-faint">Resend in {secondsLeft}s</span>
      ) : (
        <button
          type="button"
          onClick={() => void handleResend()}
          disabled={sending}
          className="font-medium text-blueprint hover:opacity-80 disabled:opacity-50"
        >
          {sending ? "Sending…" : "Resend code"}
        </button>
      )}
    </p>
  );
}
