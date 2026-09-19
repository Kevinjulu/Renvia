const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const integer = new Intl.NumberFormat("en-US");
const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export function formatUsd(value: number): string {
  return usd.format(value);
}

export function formatNumber(value: number): string {
  return integer.format(value);
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(value > 0 && value < 0.1 ? 1 : 0)}%`;
}

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

/** "2026-09-19" (a UTC day) → "Sep 19". */
export function formatDay(isoDay: string): string {
  return shortDate.format(new Date(`${isoDay}T00:00:00Z`));
}

export function formatRelative(iso: string | null): string {
  if (!iso) return "Never";
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 30 * 86_400) return `${Math.floor(seconds / 86_400)}d ago`;
  return shortDate.format(new Date(iso));
}

/** Short model name for tables: "fal-ai/flux-pro/kontext" → "flux-pro/kontext". */
export function formatModel(model: string | null): string {
  if (!model) return "—";
  return model.replace(/^fal-ai\//, "");
}
