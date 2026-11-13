import { db, pricingConfigsTable, pricingConfigHistoryTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { validatePricingConfig, type PricingConfig } from "@workspace/pricing";

export const SERVICE_CATALOG_MIGRATION_ID = "individual-services-outgoing-and-period-events";

/** Atomic audit of live catalog only. Preserve administrator prices, rate and all quote snapshots. */
export async function migrateServiceCatalog() {
  await db.transaction(async tx => {
    const [record] = await tx.select().from(pricingConfigsTable)
      .where(eq(pricingConfigsTable.id, "default")).for("update").limit(1);
    if (!record) throw new Error("Pricing configuration unavailable");
    const [done] = await tx.select().from(pricingConfigHistoryTable)
      .where(eq(pricingConfigHistoryTable.id, SERVICE_CATALOG_MIGRATION_ID)).limit(1);
    if (done) return;
    const before = record.config as PricingConfig;
    const after: PricingConfig = {
      ...before,
      individualServices: before.individualServices.map(service =>
        service.id === "logistica-salientes" ? { ...service, name: "Logística inversa (proveedor actual)", unit: "Por equipo saliente" } :
        service.id === "mantenimiento-preventivo" ? { ...service, unit: "Por equipo por evento" } : { ...service }),
    };
    if (!after.individualServices.some(s => s.id === "borrado-seguro-salientes"))
      after.individualServices.push({ id: "borrado-seguro-salientes", name: "Borrado seguro equipos salientes (proveedor actual)", unitCost: 10, unit: "Por equipo saliente", mandatory: false, active: true });
    validatePricingConfig(after);
    await tx.update(pricingConfigsTable).set({ config: after, updatedAt: new Date() }).where(eq(pricingConfigsTable.id, "default"));
    await tx.insert(pricingConfigHistoryTable).values({
      id: SERVICE_CATALOG_MIGRATION_ID, configId: "default", beforeConfig: before, afterConfig: after,
      reason: "Servicios individuales: logística y borrado de equipos salientes, mantenimiento por equipo y evento por periodo. Sin cambios en tasa ni snapshots históricos.",
    });
  });
}
