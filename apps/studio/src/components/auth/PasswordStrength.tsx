const LEVELS = [
  { label: "Weak", color: "bg-red-400" },
  { label: "Fair", color: "bg-glow" },
  { label: "Good", color: "bg-blueprint" },
  { label: "Strong", color: "bg-emerald-500" },
];

function scorePassword(password: string) {
  let score = 0;
  if (password.length >= 8) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return score;
}

export function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;

  const score = scorePassword(password);
  const level = LEVELS[Math.max(0, score - 1)] ?? LEVELS[0]!;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1">
        {LEVELS.map((_, index) => (
          <span
            key={index}
            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
              index < score ? level.color : "bg-hairline"
            }`}
          />
        ))}
      </div>
      <span className="text-xs text-faint">{level.label} password</span>
    </div>
  );
}
