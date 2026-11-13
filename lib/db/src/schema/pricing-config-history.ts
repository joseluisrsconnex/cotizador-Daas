import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const pricingConfigHistoryTable = pgTable("pricing_config_history", {
  id: text("id").primaryKey(),
  configId: text("config_id").notNull(),
  beforeConfig: jsonb("before_config").notNull(),
  afterConfig: jsonb("after_config").notNull(),
  reason: text("reason").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPricingConfigHistorySchema = createInsertSchema(pricingConfigHistoryTable).omit({ appliedAt: true });
