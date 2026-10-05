import { useEffect, useRef } from "react";
import { AccountMenu } from "../components/account/AccountMenu";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

interface DashboardTopBarProps {
  value?: string;
  onChange?: (value: string) => void;
  /** Called on Enter — sections that can't filter in place use it to search projects instead. */
  onSubmit?: (value: string) => void;
  placeholder?: string;
  onNotifications?: () => void;
}

export function DashboardTopBar({ value = "", onChange, onSubmit, placeholder = "Search projects…", onNotifications }: DashboardTopBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <header className="dashboard-topbar">
      <div className="dashboard-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
        <input
          ref={inputRef}
          role="searchbox"
          aria-label={placeholder.replace(/…$/, "")}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && value.trim()) onSubmit?.(value.trim());
            if (event.key === "Escape" && value) onChange?.("");
          }}
        />
        <kbd aria-hidden="true">{IS_MAC ? "⌘" : "Ctrl"}&nbsp; K</kbd>
      </div>
      <button type="button" onClick={onNotifications} className="dashboard-icon-button" aria-label="Recent activity" title="Recent activity"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"/><path d="M10 20h4"/></svg></button>
      <AccountMenu />
    </header>
  );
}
