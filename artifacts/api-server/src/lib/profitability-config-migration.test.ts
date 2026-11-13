import { beforeEach, describe, expect, it, vi } from "vitest";
import { clonePricingConfig, DEFAULT_PRICING_CONFIG } from "@workspace/pricing";

const state = vi.hoisted(() => ({ record: undefined as any, audit: undefined as any, writes: 0 }));
vi.mock("@workspace/db", () => ({
  pricingConfigsTable: { id: "id" }, pricingConfigHistoryTable: { id: "audit" },
  db: { transaction: async (run: any) => {
    let selects = 0;
    return run({
      select: () => ({ from: () => ({ where: () => {
        const limit = async () => ++selects === 1 ? [state.record] : state.audit ? [state.audit] : [];
        return { for: () => ({ limit }), limit };
      } }) }),
      update: () => ({ set: (value: any) => ({ where: async () => { state.record = { ...state.record, ...value }; state.writes++; } }) }),
      insert: () => ({ values: (value: any) => {
        if (value.beforeConfig) state.audit = structuredClone(value);
        return { onConflictDoNothing: async () => undefined };
      } }),
    });
  } },
}));
import { migrateProfitabilityConfig, PROFITABILITY_MIGRATION_ID } from "./profitability-config-migration";

describe("Migración P&G: conserva configuración y audita una sola vez", () => {
  beforeEach(() => {
    const { commercialMargin: _margin, profitAndLoss: _pnl, ...legacy } = clonePricingConfig(DEFAULT_PRICING_CONFIG);
    legacy.monthlyPlacementRate = .017321;
    legacy.margins[1]!.target = .15;
    state.record = { id: "default", config: legacy }; state.audit = undefined; state.writes = 0;
  });
  it("añade exclusivamente los nuevos parámetros y conserva los umbrales y tasa vigentes", async () => {
    const before = structuredClone(state.record.config);
    await migrateProfitabilityConfig();
    expect(state.record.config).toEqual({ ...before, commercialMargin: .05,
      profitAndLoss: { ica: .01, maintenance: .02, insurance: .02, badDebt: .02, incomeTax: .35 } });
    expect(state.audit).toMatchObject({ id: PROFITABILITY_MIGRATION_ID, beforeConfig: before, afterConfig: state.record.config });
    const audit = structuredClone(state.audit);
    state.record.config.commercialMargin = .07; // A later admin change must survive a restart.
    await migrateProfitabilityConfig();
    expect(state.record.config.commercialMargin).toBe(.07);
    expect(state.writes).toBe(1);
    expect(state.audit).toEqual(audit);
  });
});
