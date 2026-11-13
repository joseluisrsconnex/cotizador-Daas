import { pgEnum, pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { appUsersTable } from "./app-users";

export const userAction = pgEnum("user_action", ["role_change", "block", "unblock", "reassign"]);
export const userRoleHistoryTable = pgTable("user_role_history", {
  id: uuid("id").primaryKey(),
  userId: text("user_id").notNull().references(() => appUsersTable.id),
  changedBy: text("changed_by").notNull().references(() => appUsersTable.id),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  action: userAction("action").notNull(),
  previousValue: jsonb("previous_value").notNull(),
  newValue: jsonb("new_value").notNull(),
}, table => [index("user_role_history_user_date_idx").on(table.userId, table.changedAt)]);
export const insertUserRoleHistorySchema = createInsertSchema(userRoleHistoryTable).omit({ changedAt: true });
export type UserRoleHistoryRecord = typeof userRoleHistoryTable.$inferSelect;
