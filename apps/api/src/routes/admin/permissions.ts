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
  /** Grant or remove an unpaid plan. Admin-only until finer billing controls exist. */
  | "plans.manage";

export const ROLE_PERMISSIONS: Record<UserRole, readonly AdminPermission[]> = {
  user: [],
  analyst: ["overview.read", "renders.read", "projects.read", "segmentations.read", "credits.read", "audit.read", "incidents.read"],
  support: ["overview.read", "users.read", "customers.manage", "renders.read", "renders.recover", "projects.read", "segmentations.read", "segmentations.recover", "incidents.read", "incidents.manage"],
  billing: ["overview.read", "users.read", "customers.manage", "credits.read", "credits.manage", "audit.read", "billing.read", "billing.manage", "incidents.read", "incidents.manage"],
  admin: [
    "overview.read", "users.read", "users.manage", "renders.read", "renders.recover", "projects.read", "segmentations.read", "segmentations.recover",
    "credits.read", "credits.manage", "audit.read", "settings.read", "settings.manage", "billing.read", "billing.manage", "incidents.read", "incidents.manage", "customers.manage", "plans.manage",
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
