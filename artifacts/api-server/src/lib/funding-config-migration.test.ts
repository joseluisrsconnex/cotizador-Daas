import { beforeEach, describe, expect, it, vi } from "vitest";
import { clonePricingConfig, DEFAULT_PRICING_CONFIG } from "@workspace/pricing";

const state = vi.hoisted(() => ({ record: undefined as any, audits: [] as any[], writes: 0 }));
vi.mock("@workspace/db", () => {
  const pricingConfigsTable = { id: "config" };
  const pricingConfigHistoryTable = { id: "history" };
  return {
    pricingConfigsTable, pricingConfigHistoryTable,
    db: { transaction: async (run: any) => run({
      select: () => ({ from: (table: unknown) => ({ where: () => {
        const limit = async () => table === pricingConfigsTable ? [state.record]
          : state.audits.filter(a => a.id === "monthly-funding-rate");
        return { for: () => ({ limit }), limit };
      } }) }),
      update: () => ({ set: (value: any) => ({ where: async () => {
        state.record = { ...state.record, ...structuredClone(value) }; state.writes++;
      } }) }),
      insert: () => ({ values: async (value: any) => { state.audits.push(structuredClone(value)); } }),
    }) },
  };
});
vi.mock("./profitability-config-migration", () => ({ migrateProfitabilityConfig: async () => undefined }));
vi.mock("./pricing-model-migration", () => ({ migratePricingModel: async () => undefined }));
vi.mock("./service-catalog-migration", () => ({ migrateServiceCatalog: async () => undefined }));

import { migrateFundingConfig, FUNDING_MIGRATION_ID } from "./funding-config-migration";
import { savePricingConfig } from "./pricing-config";

describe("Tasa de captación: migración y auditoría sin cambios a colocación", () => {
  beforeEach(() => {
    state.record = { id: "default", config: clonePricingConfig(DEFAULT_PRICING_CONFIG) };
    state.record.config.monthlyPlacementRate = .017321;
    state.audits = []; state.writes = 0;
  });
  it("inicializa solo captación y no repite la migración ni sobrescribe cambios posteriores", async () => {
    delete state.record.config.monthlyFundingRate;
    const before = structuredClone(state.record.config);
    await migrateFundingConfig();
    expect(state.record.config).toEqual({ ...before, monthlyFundingRate: 0 });
    expect(state.audits).toEqual([expect.objectContaining({
      id: FUNDING_MIGRATION_ID, beforeConfig: before, afterConfig: state.record.config,
    })]);
    state.record.config.monthlyFundingRate = .008;
    await migrateFundingConfig();
    expect(state.record.config.monthlyFundingRate).toBe(.008);
    expect(state.writes).toBe(1);
  });
  it("conserva la captación existente al migrar", async () => {
    state.record.config.monthlyFundingRate = .008;
    await migrateFundingConfig();
    expect(state.record.config.monthlyFundingRate).toBe(.008);
  });
  it("guarda cada cambio normalizado a seis decimales con historial antes/después", async () => {
    await migrateFundingConfig();
    const original = structuredClone(state.record.config);
    const saved = await savePricingConfig({ ...original, monthlyFundingRate: .0081234567 });
    expect(saved.monthlyFundingRate).toBe(.008123);
    expect(saved.monthlyPlacementRate).toBe(original.monthlyPlacementRate);
    expect(state.audits.at(-1)).toMatchObject({
      beforeConfig: original, afterConfig: saved, reason: "Actualizados: tasa de captación mensual.",
    });
    const second = await savePricingConfig({ ...saved, monthlyFundingRate: .009 });
    expect(state.audits.at(-1)).toMatchObject({ beforeConfig: saved, afterConfig: second });
    expect(state.audits).toHaveLength(3);
  });
});
