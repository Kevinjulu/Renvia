import { useRef, useState, type DragEvent } from "react";

interface DropZoneProps {
  title: string;
  subtitle?: string;
  showFormatBadges?: boolean;
  size?: "compact" | "large";
  onFileSelected: (file: File) => void;
  disabled?: boolean;
}

export function DropZone({
  title,
  subtitle = "or click to browse from your device",
  showFormatBadges = false,
  size = "compact",
  onFileSelected,
  disabled = false,
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFileSelected(file);
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(event) => {
        if (!disabled && (event.key === "Enter" || event.key === " ")) inputRef.current?.click();
      }}
      onDragOver={(event: DragEvent) => {
        event.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event: DragEvent) => {
        event.preventDefault();
        setIsDragging(false);
        if (!disabled) handleFiles(event.dataTransfer.files);
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-center transition-colors ${
        isDragging ? "border-blueprint bg-blueprint-soft" : "border-hairline-strong bg-white"
      } ${size === "large" ? "gap-3 p-16" : "p-6"} ${disabled ? "cursor-not-allowed opacity-50" : "hover:border-primary/30"}`}
    >
      <svg
        width={size === "large" ? 28 : 20}
        height={size === "large" ? 28 : 20}
        viewBox="0 0 20 20"
        fill="none"
        className="text-faint"
        aria-hidden="true"
      >
        <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="7" cy="8" r="1.3" stroke="currentColor" strokeWidth="1.1" />
        <path d="M3 14.5 7.5 10l3 3 2.5-2.5L17 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className={size === "large" ? "text-base font-medium text-primary" : "text-sm font-medium text-primary"}>
        {title}
      </p>
      <p className="text-xs text-muted">{subtitle}</p>
      {showFormatBadges && (
        <div className="mt-1 flex gap-1.5">
          {["PNG", "JPEG", "WEBP"].map((format) => (
            <span key={format} className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-medium text-secondary">
              {format}
            </span>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        disabled={disabled}
        onChange={(event) => handleFiles(event.target.files)}
      />
    </div>
  );
}
