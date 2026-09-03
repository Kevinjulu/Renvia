import { MARKETING_URL } from "../../lib/env";

interface TermsCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function TermsCheckbox({ checked, onChange }: TermsCheckboxProps) {
  return (
    <label className="flex items-start gap-2.5 text-xs text-muted">
      <input
        type="checkbox"
        required
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-hairline-strong text-blueprint focus-visible:ring-2 focus-visible:ring-blueprint"
      />
      <span>
        I agree to the{" "}
        <a href={`${MARKETING_URL}/terms`} target="_blank" rel="noreferrer" className="font-medium text-primary hover:opacity-80">
          Terms of Service
        </a>{" "}
        and{" "}
        <a href={`${MARKETING_URL}/privacy`} target="_blank" rel="noreferrer" className="font-medium text-primary hover:opacity-80">
          Privacy Policy
        </a>
        .
      </span>
    </label>
  );
}
