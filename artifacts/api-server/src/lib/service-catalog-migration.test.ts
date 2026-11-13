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
      insert: () => ({ values: async (value: any) => { state.audit = structuredClone(value); } }),
    });
  } },
}));
import { migrateServiceCatalog, SERVICE_CATALOG_MIGRATION_ID } from "./service-catalog-migration";

describe("Migración de servicios auditada e idempotente", () => {
  beforeEach(() => {
    const config = clonePricingConfig(DEFAULT_PRICING_CONFIG);
    config.monthlyPlacementRate = .017321;
    config.individualServices = config.individualServices.filter(s => s.id !== "borrado-seguro-salientes")
      .map(s => s.id === "logistica-salientes" ? { ...s, name: "Logística de equipos salientes", unit: "Por equipo" } :
        s.id === "mantenimiento-preventivo" ? { ...s, unit: "Por equipo" } : s);
    state.record = { id: "default", config }; state.audit = undefined; state.writes = 0;
  });
  it("cambia solo catálogo, conserva tasa/costos/activos y registra antes/después una sola vez", async () => {
    const before = structuredClone(state.record.config);
    await migrateServiceCatalog();
    const after = state.record.config;
    expect({ ...after, individualServices: [] }).toEqual({ ...before, individualServices: [] });
    expect(after.individualServices.find((s: any) => s.id === "logistica-salientes"))
      .toMatchObject({ name: "Logística inversa (proveedor actual)", unitCost: 25, unit: "Por equipo saliente" });
    expect(after.individualServices.find((s: any) => s.id === "mantenimiento-preventivo"))
      .toMatchObject({ unitCost: 15, unit: "Por equipo por evento" });
    expect(after.individualServices.find((s: any) => s.id === "borrado-seguro-salientes"))
      .toMatchObject({ unitCost: 10, unit: "Por equipo saliente", mandatory: false });
    expect(state.audit).toMatchObject({ id: SERVICE_CATALOG_MIGRATION_ID, beforeConfig: before, afterConfig: after });
    const audit = structuredClone(state.audit);
    await migrateServiceCatalog();
    expect(state.writes).toBe(1);
    expect(state.audit).toEqual(audit);
  });
});
