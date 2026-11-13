import { db, pricingConfigsTable, pricingConfigHistoryTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { DEFAULT_PRICING_CONFIG } from "@workspace/pricing";

export const PROFITABILITY_MIGRATION_ID = "commercial-margin-and-business-profitability";

/** Only live settings change. The locked audit and the update commit together. */
export async function migrateProfitabilityConfig() {
  await db.transaction(async tx => {
    await tx.insert(pricingConfigsTable).values({ id: "default", config: DEFAULT_PRICING_CONFIG })
      .onConflictDoNothing({ target: pricingConfigsTable.id });
    const [record] = await tx.select().from(pricingConfigsTable)
      .where(eq(pricingConfigsTable.id, "default")).for("update").limit(1);
    if (!record) throw new Error("Pricing configuration unavailable");
    const [done] = await tx.select().from(pricingConfigHistoryTable)
      .where(eq(pricingConfigHistoryTable.id, PROFITABILITY_MIGRATION_ID)).limit(1);
    if (done) return;
    const before = record.config as Record<string, unknown>;
    const after = { ...before, commercialMargin: before.commercialMargin ?? 0.05,
      profitAndLoss: before.profitAndLoss ?? { ...DEFAULT_PRICING_CONFIG.profitAndLoss } };
    await tx.update(pricingConfigsTable).set({ config: after, updatedAt: new Date() })
      .where(eq(pricingConfigsTable.id, "default"));
    await tx.insert(pricingConfigHistoryTable).values({
      id: PROFITABILITY_MIGRATION_ID, configId: "default", beforeConfig: before, afterConfig: after,
      reason: "Separación de margen comercial (5 %) y rentabilidad neta. Parámetros P&G: ICA 1 %, mantenimiento 2 %, seguros 2 %, cartera 2 % y renta 35 %. Sin recalcular cotizaciones históricas.",
    });
  });
}
