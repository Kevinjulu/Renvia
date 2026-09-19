interface AvatarProps {
  name: string;
  imageUrl?: string | null;
  size?: number;
  className?: string;
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]![0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Uploaded photo when there is one, otherwise initials on the brand gradient. */
export function Avatar({ name, imageUrl, size = 32, className = "" }: AvatarProps) {
  return (
    <span className={`account-avatar ${className}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}>
      {imageUrl ? <img src={imageUrl} alt="" draggable={false} /> : <span aria-hidden="true">{initialsFor(name)}</span>}
    </span>
  );
}
