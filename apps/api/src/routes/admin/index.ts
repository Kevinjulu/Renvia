import { Hono } from "hono";
import { requireAuth } from "../../middleware/auth.js";
import type { AdminContext } from "./context.js";
import { requireOperator } from "./permissions.js";
import { overviewRoutes } from "./overview.js";
import { usersRoutes } from "./users.js";
import { governanceRoutes } from "./governance.js";
import { userDetailRoutes } from "./userDetail.js";
import { rendersRoutes } from "./renders.js";
import { settingsRoutes } from "./settings.js";
import { projectsRoutes } from "./projects.js";
import { creditsRoutes } from "./credits.js";
import { billingRoutes } from "./billing.js";
import { segmentationsRoutes } from "./segmentations.js";
import { incidentsRoutes } from "./incidents.js";
import { auditRoutes } from "./audit.js";

export const admin = new Hono<AdminContext>();

admin.use("*", requireAuth, requireOperator);

// Mounted in the order the routes were originally declared: Hono matches in registration order.
admin.route("/", overviewRoutes);
admin.route("/", usersRoutes);
admin.route("/", governanceRoutes);
admin.route("/", userDetailRoutes);
admin.route("/", rendersRoutes);
admin.route("/", settingsRoutes);
admin.route("/", projectsRoutes);
admin.route("/", creditsRoutes);
admin.route("/", billingRoutes);
admin.route("/", segmentationsRoutes);
admin.route("/", incidentsRoutes);
admin.route("/", auditRoutes);
