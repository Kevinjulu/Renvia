import { schema, type Database } from "@renvia/db";
import type { AuthVariables, Env } from "../../index.js";

export type UserRow = typeof schema.users.$inferSelect;
export type AdminContext = { Bindings: Env; Variables: AuthVariables & { admin: UserRow; db: Database } };
