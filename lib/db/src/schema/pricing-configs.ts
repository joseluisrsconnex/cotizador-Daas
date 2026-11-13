import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod/v4";

export const pricingConfigsTable = pgTable("pricing_configs", {
  id: text("id").primaryKey(),
  config: jsonb("config").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertPricingConfigSchema = createInsertSchema(pricingConfigsTable).omit({
  updatedAt: true,
});
export type InsertPricingConfig = z.infer<typeof insertPricingConfigSchema>;
export type PricingConfigRecord = typeof pricingConfigsTable.$inferSelect;
