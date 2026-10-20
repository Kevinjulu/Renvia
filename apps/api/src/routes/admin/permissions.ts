import { createMiddleware } from "hono/factory";
import { createDb } from "@renvia/db";
import type { UserRole } from "@renvia/types";
import { getOrCreateUser } from "../../lib/users.js";
import type { UserRow, AdminContext } from "./context.js";

export type AdminPermission =
  | "overview.read"
  | "users.read"
  | "users.manage"
  | "customers.manage"
  | "renders.read"
  | "renders.recover"
  | "projects.read"
  | "segmentations.read"
  | "segmentations.recover"
  | "credits.read"
  | "credits.manage"
  | "audit.read"
  | "settings.read"
  | "settings.manage"
  | "billing.read"
  | "billing.manage"
  | "incidents.read"
  | "incidents.manage"
  /** See Studio Control: feature rules, revisions and maintenance windows. */
  | "studio.read"
  /** Publish or restore Studio Control feature rules. */
  | "studio.manage"
  /** Grant or remove an unpaid plan. Admin-only until finer billing controls exist. */
  | "plans.manage"
  /** See beta programs, testers, invitations and their spend. */
  | "beta.read"
  /** Invite testers, and suspend, reactivate, extend, complete or revoke them. */
  | "beta.testers.manage"
  /** Grant beta credits beyond the welcome amount. */
  | "beta.credits.manage"
  /** Create and configure programs: dates, limits, benefits, status and budget. */
  | "beta.programs.manage"
  /** Triage beta feedback and reply to testers. */
  | "beta.feedback.manage"
  /** Upload, caption, hide, order and delete the sample references every Studio user sees. */
  | "library.manage"
  /** See an account's Free-allowance eligibility and the evidence behind it. */
  | "security.read"
  /** Approve an account's Free allowance, send it to review, or have the rules reassess it. */
  | "security.review"
  /** Deny an account's Free allowance, or lift a denial. */
  | "security.manage";

export const ROLE_PERMISSIONS: Record<UserRole, readonly AdminPermission[]> = {
  user: [],
  analyst: ["overview.read", "renders.read", "projects.read", "segmentations.read", "credits.read", "audit.read", "incidents.read", "studio.read", "beta.read", "security.read"],
  support: ["overview.read", "users.read", "customers.manage", "renders.read", "renders.recover", "projects.read", "segmentations.read", "segmentations.recover", "incidents.read", "incidents.manage", "studio.read", "beta.read", "beta.testers.manage", "beta.feedback.manage", "security.read", "security.review"],
  billing: ["overview.read", "users.read", "customers.manage", "credits.read", "credits.manage", "audit.read", "billing.read", "billing.manage", "incidents.read", "incidents.manage", "beta.read", "beta.credits.manage", "security.read"],
  admin: [
    "overview.read", "users.read", "users.manage", "renders.read", "renders.recover", "projects.read", "segmentations.read", "segmentations.recover",
    "credits.read", "credits.manage", "audit.read", "settings.read", "settings.manage", "billing.read", "billing.manage", "incidents.read", "incidents.manage", "customers.manage", "plans.manage", "studio.read", "studio.manage",
    "beta.read", "beta.testers.manage", "beta.credits.manage", "beta.programs.manage", "beta.feedback.manage", "library.manage",
    "security.read", "security.review", "security.manage",
  ],
};

export function hasPermission(role: UserRole, permission: AdminPermission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function denyUnless(c: { get: (key: "admin") => UserRow }, permission: AdminPermission) {
  return hasPermission(c.get("admin").role as UserRole, permission) ? null : { error: "Forbidden" };
}

/** Only active staff get past this — capability checks happen on every route below. */
export const requireOperator = createMiddleware<AdminContext>(async (c, next) => {
  const db = createDb(c.env.DATABASE_URL);
  const user = await getOrCreateUser(c.env, db, c.get("auth").clerkId);
  if (!hasPermission(user.role as UserRole, "overview.read") || user.disabled) {
    return c.json({ error: "Forbidden" }, 403);
  }
  c.set("admin", user);
  c.set("db", db);
  await next();
});
