import { beforeEach, describe, expect, it, vi } from "vitest";
import { clonePricingConfig, DEFAULT_PRICING_CONFIG, NEW_ASSET_TYPES } from "@workspace/pricing";

const state = vi.hoisted(() => ({
  record: undefined as any, audit: undefined as any, writes: 0,
}));
vi.mock("@workspace/db", () => ({
  pricingConfigsTable: { id: "id" },
  pricingConfigHistoryTable: { id: "history-id" },
  db: { transaction: async (run: any) => {
    let selects = 0;
    const tx = {
      insert: () => ({ values: (value: any) => {
        if (value.beforeConfig) state.audit = value;
        return { onConflictDoNothing: async () => undefined };
      } }),
      select: () => ({ from: () => ({ where: () => {
        const limit = async () => ++selects === 1 ? [state.record] : state.audit ? [state.audit] : [];
        return { for: () => ({ limit }), limit };
      } }) }),
      update: () => ({ set: (value: any) => ({ where: async () => {
        state.record = { ...state.record, ...value }; state.writes++;
      } }) }),
    };
    return run(tx);
  } },
}));
import { migratePricingModel, PRICING_MODEL_MIGRATION_ID } from "./pricing-model-migration";

describe("Migración auditada del modelo de precios", () => {
  beforeEach(() => {
    const current = clonePricingConfig(DEFAULT_PRICING_CONFIG);
    const { margins, individualServices: _services, ...legacy } = current;
    state.record = { id: "default", config: {
      ...legacy, monthlyPlacementRate: .017321,
      spareBases: legacy.spareBases.slice(0, 8).map(row => ({ ...row, units: row.units + 1 })),
      residuals: legacy.residuals.map(row => ({ ...row, assets: row.assets.slice(0, 8) })),
      minimumMargins: margins.map(row => ({ termMonths: row.termMonths, fraction: row.minimum })),
    } };
    state.audit = undefined; state.writes = 0;
  });

  it("conserva tasa y activos previos, carga los valores pedidos y audita una sola vez", async () => {
    const before = structuredClone(state.record.config);
    await migratePricingModel();
    const after = state.record.config;
    expect(after.monthlyPlacementRate).toBe(before.monthlyPlacementRate);
    expect(after.spareBases.slice(0, 8)).toEqual(before.spareBases);
    after.residuals.forEach((row: any, i: number) => {
      expect(row.assets.slice(0, 8)).toEqual(before.residuals[i].assets);
      expect(row.assets.slice(8)).toEqual(NEW_ASSET_TYPES.map(assetType => ({ assetType, fraction: 0 })));
    });
    expect(after.spareBases.slice(8).map((row: any) => row.units)).toEqual([10, 10, 20]);
    expect(after).not.toHaveProperty("minimumMargins");
    expect(after.margins).toEqual([
      { termMonths: 12, target: .12, minimum: .10, profitable: .14 },
      { termMonths: 24, target: .14, minimum: .12, profitable: .16 },
      { termMonths: 36, target: .16, minimum: .14, profitable: .18 },
      { termMonths: 48, target: .20, minimum: .18, profitable: .22 },
      { termMonths: 60, target: .22, minimum: .20, profitable: .24 },
    ]);
    expect(after.servicePackages.map((row: any) => row.unitCost)).toEqual([40, 60, 80]);
    expect(after.individualServices).toHaveLength(14);
    expect(state.audit).toMatchObject({ id: PRICING_MODEL_MIGRATION_ID, beforeConfig: before, afterConfig: after });
    const audit = structuredClone(state.audit);
    await migratePricingModel();
    expect(state.writes).toBe(1);
    expect(state.audit).toEqual(audit);
  });
});
