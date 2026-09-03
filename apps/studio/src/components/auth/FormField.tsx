import { forwardRef, useState, type InputHTMLAttributes, type ReactNode } from "react";

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  labelAction?: ReactNode;
  hint?: string;
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.5 8S3.8 3.5 8 3.5 14.5 8 14.5 8 12.2 12.5 8 12.5 1.5 8 1.5 8Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.5 8S3.8 3.5 8 3.5c1.4 0 2.6.4 3.6 1M14.5 8S13.6 9.8 11.8 11.1M8 12.5c-1.1 0-2.1-.3-3-.7"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M2 2 14 14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export const FormField = forwardRef<HTMLInputElement, FormFieldProps>(function FormField(
  { label, error, labelAction, hint, id, type, onBlur, onChange, ...inputProps },
  ref,
) {
  const [visible, setVisible] = useState(false);
  const [touched, setTouched] = useState(false);
  const [localError, setLocalError] = useState("");
  const fieldId = id ?? label.toLowerCase().replace(/\s+/g, "-");
  const isPassword = type === "password";
  const displayError = error || (touched ? localError : "");

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={fieldId} className="text-sm font-medium text-primary">
          {label}
        </label>
        {labelAction}
      </div>
      <div className="relative">
        <input
          ref={ref}
          id={fieldId}
          type={isPassword && visible ? "text" : type}
          aria-invalid={Boolean(displayError)}
          onBlur={(event) => {
            setTouched(true);
            setLocalError(event.target.validity.valid ? "" : event.target.validationMessage);
            onBlur?.(event);
          }}
          onChange={(event) => {
            onChange?.(event);
            if (touched) {
              setLocalError(event.target.validity.valid ? "" : event.target.validationMessage);
            }
          }}
          className={`w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-primary outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-blueprint ${
            isPassword ? "pr-10" : ""
          } ${displayError ? "border-red-400" : "border-hairline"}`}
          {...inputProps}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Hide password" : "Show password"}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint transition-colors hover:text-secondary"
          >
            {visible ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
      </div>
      {hint && !displayError && <p className="text-xs text-faint">{hint}</p>}
      {displayError && <p className="text-xs text-red-600">{displayError}</p>}
    </div>
  );
});
