import { pgTable, text, timestamp, integer, jsonb, uuid } from "drizzle-orm/pg-core";
export const users = pgTable("users", {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkId: text("clerk_id").notNull().unique(),
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const projects = pgTable("projects", {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
        .notNull()
        .references(() => users.id),
    name: text("name").notNull(),
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
    falRequestId: text("fal_request_id"),
    errorMessage: text("error_message"),
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
    amount: integer("amount").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
//# sourceMappingURL=schema.js.map