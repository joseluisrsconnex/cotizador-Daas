import { db, pricingConfigsTable, pricingConfigHistoryTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { DEFAULT_PRICING_CONFIG, NEW_ASSET_TYPES, clonePricingConfig, validatePricingConfig, type PricingConfig } from "@workspace/pricing";
import { GetDaasConfigResponse } from "@workspace/api-zod";

export const PRICING_MODEL_MIGRATION_ID = "pricing-assets-period-margins-individual-services";

/** No schema DDL, no quote updates. One locked, atomic before/after configuration audit. */
export async function migratePricingModel() {
  await db.transaction(async tx => {
    await tx.insert(pricingConfigsTable).values({ id: "default", config: DEFAULT_PRICING_CONFIG })
      .onConflictDoNothing({ target: pricingConfigsTable.id });
    const [record] = await tx.select().from(pricingConfigsTable)
      .where(eq(pricingConfigsTable.id, "default")).for("update").limit(1);
    if (!record) throw new Error("Pricing configuration unavailable");
    const [done] = await tx.select({ id: pricingConfigHistoryTable.id }).from(pricingConfigHistoryTable)
      .where(eq(pricingConfigHistoryTable.id, PRICING_MODEL_MIGRATION_ID)).limit(1);
    if (done) return;
    const previous = record.config as Record<string, unknown>;
    const defaults = clonePricingConfig(DEFAULT_PRICING_CONFIG);
    const isNew = (type: string) => (NEW_ASSET_TYPES as readonly string[]).includes(type);
    const { minimumMargins: _legacy, ...preserved } = previous;
    const revised = GetDaasConfigResponse.parse({
      ...preserved,
      // Preserve the administrator's actual rate and every existing asset's settings.
      monthlyPlacementRate: previous.monthlyPlacementRate,
      spareBases: [
        ...(previous.spareBases as PricingConfig["spareBases"]).filter(item => !isNew(item.assetType)),
        ...defaults.spareBases.filter(item => isNew(item.assetType)),
      ],
      residuals: (previous.residuals as PricingConfig["residuals"]).map(group => ({
        ...group, assets: [
          ...group.assets.filter(item => !isNew(item.assetType)),
          ...NEW_ASSET_TYPES.map(assetType => ({ assetType, fraction: 0 })),
        ],
      })),
      margins: defaults.margins, servicePackages: defaults.servicePackages,
      individualServices: defaults.individualServices,
    }) as PricingConfig;
    validatePricingConfig(revised);
    await tx.update(pricingConfigsTable).set({ config: revised, updatedAt: new Date() })
      .where(eq(pricingConfigsTable.id, "default"));
    await tx.insert(pricingConfigHistoryTable).values({
      id: PRICING_MODEL_MIGRATION_ID, configId: "default", beforeConfig: record.config, afterConfig: revised,
      reason: "Nuevos activos, márgenes Objetivo/Mínimo/Rentable, paquetes 40/60/80 USD y catálogo de servicios individuales. Se conserva la tasa vigente.",
    });
  });
}
