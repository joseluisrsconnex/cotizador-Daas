import { boolean, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const appRole = pgEnum("app_role", ["comercial", "admin", "gerente_comercial"]);
export const appUsersTable = pgTable("app_users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: appRole("role").notNull().default("comercial"),
  isBlocked: boolean("is_blocked").notNull().default(false),
  lastAccessAt: timestamp("last_access_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertAppUserSchema = createInsertSchema(appUsersTable).omit({ createdAt: true });
export type AppUserRecord = typeof appUsersTable.$inferSelect;
