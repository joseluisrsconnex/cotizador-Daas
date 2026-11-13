import { db, pricingConfigsTable, pricingConfigHistoryTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { DEFAULT_PRICING_CONFIG } from "@workspace/pricing";

export const FUNDING_MIGRATION_ID = "monthly-funding-rate";

/** Only initialize live settings; never alter historical versions or their evaluations. */
export async function migrateFundingConfig() {
  await db.transaction(async tx => {
    const [record] = await tx.select().from(pricingConfigsTable)
      .where(eq(pricingConfigsTable.id, "default")).for("update").limit(1);
    if (!record) throw new Error("Pricing configuration unavailable");
    const [done] = await tx.select().from(pricingConfigHistoryTable)
      .where(eq(pricingConfigHistoryTable.id, FUNDING_MIGRATION_ID)).limit(1);
    if (done) return;
    const before = record.config as Record<string, unknown>;
    const after = { ...before, monthlyFundingRate: before.monthlyFundingRate ?? DEFAULT_PRICING_CONFIG.monthlyFundingRate };
    await tx.update(pricingConfigsTable).set({ config: after, updatedAt: new Date() })
      .where(eq(pricingConfigsTable.id, "default"));
    await tx.insert(pricingConfigHistoryTable).values({
      id: FUNDING_MIGRATION_ID, configId: "default", beforeConfig: before, afterConfig: after,
      reason: "Tasa de captación mensual: inicialización al 0 % si no existe. Solo afecta rentabilidad de nuevas versiones; no modifica el canon ni cotizaciones históricas.",
    });
  });
}
