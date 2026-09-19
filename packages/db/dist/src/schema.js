import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, integer, jsonb, uuid, boolean, index, uniqueIndex, check } from "drizzle-orm/pg-core";
export const users = pgTable("users", {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkId: text("clerk_id").notNull().unique(),
    email: text("email").notNull(),
    role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
    /** Spendable credits (1 credit = 1 image); every change is mirrored in credit_ledger. */
    creditBalance: integer("credit_balance").notNull().default(0),
    disabled: boolean("disabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [check("users_credit_balance_non_negative", sql `${table.creditBalance} >= 0`)]);
export const projects = pgTable("projects", {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
        .notNull()
        .references(() => users.id),
    name: text("name").notNull(),
    thumbnailUrl: text("thumbnail_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const canvasNodes = pgTable("canvas_nodes", {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
        .notNull()
        .references(() => projects.id),
    type: text("type").notNull(),
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const renders = pgTable("renders", {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
        .notNull()
        .references(() => projects.id),
    status: text("status", { enum: ["pending", "processing", "succeeded", "failed"] })
        .notNull()
        .default("pending"),
    sourceImageUrl: text("source_image_url").notNull(),
    resultImageUrl: text("result_image_url"),
    prompt: text("prompt").notNull(),
    resolution: text("resolution").notNull().default("1K"),
    style: text("style").notNull().default("Photorealistic"),
    viewKey: text("view_key"),
    viewLabel: text("view_label"),
    falRequestId: text("fal_request_id"),
    errorMessage: text("error_message"),
    // Engine model id ("mock" in mock mode) and its estimated cost in USD micros
    // (1e-6 USD) — summed to enforce the fal spending cap.
    model: text("model"),
    costMicros: integer("cost_micros").notNull().default(0),
    settings: jsonb("settings").$type(),
    /** Credits debited when the render was created; refunded if it fails. */
    creditsCharged: integer("credits_charged").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const referenceImages = pgTable("reference_images", {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
        .notNull()
        .references(() => users.id),
    url: text("url").notNull(),
    source: text("source", { enum: ["upload", "unsplash", "url"] })
        .notNull()
        .default("upload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const creditLedger = pgTable("credit_ledger", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
    /** Positive for grants and refunds, negative for spending. */
    amount: integer("amount").notNull(),
    reason: text("reason", {
        enum: ["signup_bonus", "initial_grant", "admin_grant", "render", "render_refund", "purchase"],
    }).notNull(),
    renderId: uuid("render_id").references(() => renders.id, { onDelete: "set null" }),
    note: text("note"),
    /** Admin who made a manual adjustment. */
    actorId: uuid("actor_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    // One debit and at most one refund per render, so a refund can never be applied twice.
    uniqueIndex("credit_ledger_render_reason_unique").on(table.renderId, table.reason),
    index("credit_ledger_user_created_idx").on(table.userId, table.createdAt),
]);
//# sourceMappingURL=schema.js.map