import { db, pricingConfigsTable, pricingConfigHistoryTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { validatePricingConfig, type PricingConfig } from "@workspace/pricing";
import { GetDaasConfigResponse } from "@workspace/api-zod";
import { QuotePricingError } from "./quote-pricing";
import { normalizePricingConfig } from "@workspace/pricing/normalization";
import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { migratePricingModel } from "./pricing-model-migration";
import { migrateServiceCatalog } from "./service-catalog-migration";
import { migrateProfitabilityConfig } from "./profitability-config-migration";
import { migrateFundingConfig } from "./funding-config-migration";

let migrationPromise: Promise<void> | undefined;

/** Idempotent data migration. The schema is applied separately by the managed database flow. */
export function ensurePricingMigration(): Promise<void> {
  if (!migrationPromise) migrationPromise = migrateProfitabilityConfig().then(() => migrateFundingConfig()).then(() => migratePricingModel()).then(() => migrateServiceCatalog()).then(() => normalizeStoredPricingConfig()).catch(error => {
    migrationPromise = undefined;
    throw error;
  });
  return migrationPromise;
}

export class CatalogRetentionError extends Error {}

/** Normalize only the live configuration. Quote snapshots and earlier audit rows stay untouched. */
export async function normalizeStoredPricingConfig(): Promise<void> {
  await db.transaction(async tx => {
    const [record] = await tx.select().from(pricingConfigsTable)
      .where(eq(pricingConfigsTable.id, "default")).for("update").limit(1);
    if (!record) throw new Error("Pricing configuration unavailable");
    const previous = GetDaasConfigResponse.parse(record.config) as PricingConfig;
    const normalized = normalizePricingConfig(previous);
    validatePricingConfig(normalized);
    if (isDeepStrictEqual(previous, normalized)) return;
    await tx.update(pricingConfigsTable).set({ config: normalized, updatedAt: new Date() })
      .where(eq(pricingConfigsTable.id, "default"));
    await tx.insert(pricingConfigHistoryTable).values({
      id: randomUUID(), configId: "default", beforeConfig: previous, afterConfig: normalized,
      reason: "Normalización de porcentajes a seis decimales; se conservan los snapshots históricos.",
    });
  });
}

export async function savePricingConfig(input: PricingConfig): Promise<PricingConfig> {
  await ensurePricingMigration();
  validatePricingConfig(input);
  const config = normalizePricingConfig(input);
  validatePricingConfig(config);
  return db.transaction(async tx => {
    const [record] = await tx.select().from(pricingConfigsTable)
      .where(eq(pricingConfigsTable.id, "default")).for("update").limit(1);
    if (!record) throw new Error("Pricing configuration unavailable");
    const previous = GetDaasConfigResponse.parse(record.config) as PricingConfig;
    if (previous.individualServices.some(item => !config.individualServices.some(next => next.id === item.id)))
      throw new CatalogRetentionError("Desactive los servicios en lugar de eliminarlos.");
    if (isDeepStrictEqual(previous, config)) return previous;
    const labels: Record<keyof PricingConfig, string> = {
      commercialMargin: "margen comercial", profitAndLoss: "parámetros P&G",
      monthlyPlacementRate: "tasa de colocación", monthlyFundingRate: "tasa de captación mensual", spareBases: "bases para spare",
      residuals: "residuales", margins: "márgenes por periodo", servicePackages: "paquetes",
      individualServices: "servicios individuales",
    };
    const changes = (Object.keys(labels) as Array<keyof PricingConfig>)
      .filter(key => !isDeepStrictEqual(previous[key], config[key])).map(key => labels[key]);
    await tx.update(pricingConfigsTable).set({ config, updatedAt: new Date() })
      .where(eq(pricingConfigsTable.id, "default"));
    await tx.insert(pricingConfigHistoryTable).values({
      id: randomUUID(), configId: "default", beforeConfig: previous, afterConfig: config,
      reason: `Actualizados: ${changes.join(", ")}.`,
    });
    return config;
  });
}

export async function getPricingConfig(): Promise<PricingConfig> {
  await ensurePricingMigration();
  const [record] = await db.select().from(pricingConfigsTable).where(eq(pricingConfigsTable.id, "default")).limit(1);
  if (!record) throw new Error("Pricing configuration unavailable");
  const parsed = GetDaasConfigResponse.safeParse(record.config);
  if (!parsed.success) throw new QuotePricingError(`Configuración persistida inválida: ${parsed.error.message}`);
  return parsed.data as PricingConfig;
}
