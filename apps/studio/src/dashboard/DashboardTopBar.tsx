import { useEffect, useRef } from "react";
import { BellIcon, SearchIcon } from "./icons";

interface DashboardTopBarProps {
  title: string;
  search: string;
  onSearchChange: (value: string) => void;
}

export function DashboardTopBar({ title, search, onSearchChange }: DashboardTopBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if (event.key === "Escape" && document.activeElement === inputRef.current) {
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-6 border-b border-hairline bg-white px-8">
      <h1 className="font-display text-lg font-semibold text-primary">{title}</h1>

      <div className="flex items-center gap-3.5">
        <div className="flex h-9 w-[380px] items-center gap-2.5 rounded-full border border-hairline bg-surface-muted pl-3.5 pr-2 transition-colors focus-within:border-hairline-strong focus-within:bg-white">
          <span className="text-faint">
            <SearchIcon />
          </span>
          <input
            ref={inputRef}
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search projects"
            aria-label="Search projects"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-primary outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:appearance-none"
          />
          <kbd className="rounded-[5px] border border-hairline bg-white px-1.5 py-0.5 font-mono text-[10px] font-normal text-faint">
            ⌘K
          </kbd>
        </div>

        <button
          type="button"
          disabled
          title="Coming soon"
          aria-label="Notifications"
          className="flex h-9 w-9 cursor-default items-center justify-center rounded-full border border-hairline bg-white text-faint/70"
        >
          <BellIcon />
        </button>
      </div>
    </header>
  );
}
