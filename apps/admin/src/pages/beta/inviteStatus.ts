import type { AdminBetaEnrollment, AdminBetaInvitation } from "@renvia/types";

/** Where an account stands in one program, for the invite picker. */
export type InviteStanding = "tester" | "invited" | "former" | null;

export function standingIn(userId: string, enrollments: Pick<AdminBetaEnrollment, "userId" | "status">[], invitations: Pick<AdminBetaInvitation, "userId" | "state">[]): InviteStanding {
  const enrollment = enrollments.find((row) => row.userId === userId);
  if (enrollment && (enrollment.status === "active" || enrollment.status === "suspended")) return "tester";
  if (enrollment) return "former";
  if (invitations.some((row) => row.userId === userId && row.state === "pending")) return "invited";
  return null;
}

/** "3h ago", "5d ago", "never". */
export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return minutes <= 1 ? "just now" : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 60) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

/** Initials and a stable tint for an account's avatar. */
export function avatarFor(email: string): { initials: string; tint: string } {
  const name = email.split("@")[0] ?? email;
  const parts = name.split(/[._-]+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase() || "?";
  const tints = ["bg-blue-100 text-blue-700", "bg-emerald-100 text-emerald-700", "bg-amber-100 text-amber-800", "bg-rose-100 text-rose-700", "bg-violet-100 text-violet-700", "bg-cyan-100 text-cyan-800"];
  let hash = 0;
  for (const char of email) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { initials, tint: tints[hash % tints.length]! };
}
