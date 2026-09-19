/** Only providers enabled in the Clerk instance — a disabled one fails after the redirect. */
export type SocialStrategy = "oauth_google";

interface SocialButtonsProps {
  onSelect: (strategy: SocialStrategy) => void;
  disabled?: boolean;
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M15.5 8.18c0-.57-.05-1.12-.15-1.64H8v3.1h4.2a3.6 3.6 0 0 1-1.56 2.36v1.96h2.52c1.48-1.36 2.34-3.37 2.34-5.78Z"
        fill="#4285F4"
      />
      <path
        d="M8 15.5c2.1 0 3.87-.7 5.16-1.9l-2.52-1.96c-.7.47-1.6.75-2.64.75-2.03 0-3.75-1.37-4.36-3.21H1.03v2.02A7.5 7.5 0 0 0 8 15.5Z"
        fill="#34A853"
      />
      <path d="M3.64 8.18a4.5 4.5 0 0 1 0-2.87V3.29H1.03a7.5 7.5 0 0 0 0 6.9l2.6-2.01Z" fill="#FBBC05" />
      <path
        d="M8 4.11c1.14 0 2.17.4 2.97 1.16l2.24-2.24A7.16 7.16 0 0 0 8 1a7.5 7.5 0 0 0-6.97 4.29l2.6 2.02C4.24 5.47 5.97 4.11 8 4.11Z"
        fill="#EA4335"
      />
    </svg>
  );
}


export function SocialButtons({ onSelect, disabled }: SocialButtonsProps) {
  return (
    <div className="flex flex-col gap-2.5">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelect("oauth_google")}
        className="flex items-center justify-center gap-2 rounded-lg border border-hairline bg-white px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:border-hairline-strong disabled:opacity-50"
      >
        <GoogleIcon />
        Continue with Google
      </button>
    </div>
  );
}

export function AuthDivider() {
  return (
    <div className="flex items-center gap-3">
      <span className="h-px flex-1 bg-hairline" />
      <span className="text-xs uppercase tracking-wide text-faint">or</span>
      <span className="h-px flex-1 bg-hairline" />
    </div>
  );
}
