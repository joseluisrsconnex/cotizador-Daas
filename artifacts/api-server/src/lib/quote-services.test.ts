import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { calculateInstallment, clonePricingConfig, DEFAULT_PRICING_CONFIG, TERM_MONTHS, type CustomQuoteService, type QuoteServiceInput } from "@workspace/pricing";
import { priceQuote } from "./quote-pricing";
import { resolveQuoteServices, ServiceSelectionError } from "./quote-services";

const rows = [
  { assetType: "HW Seguridad" as const, reference: "Firewall", quantity: 2, unitCost: 1200 },
  { assetType: "Equipos POS" as const, reference: "Terminal", quantity: 3, unitCost: 700 },
  { assetType: "Licenciamiento" as const, reference: "Licencia", quantity: 5, unitCost: 80 },
];
const noMandatory = () => {
  const config = clonePricingConfig(DEFAULT_PRICING_CONFIG);
  config.individualServices.forEach(row => { row.mandatory = false; });
  return config;
};
const individual = { serviceMode: "Servicios individuales" as const, packageType: null, selectedServices: [] };

describe("Servicios: financiación, cantidades, unidades y privacidad", () => {
  for (const termMonths of TERM_MONTHS) {
    for (const unit of ["Por equipo", "Por perfil", "Por evento", "Por año"] as const) {
      it(`${unit} a ${termMonths} meses reparte correctamente entre todas las unidades`, () => {
        const config = noMandatory();
        const service: CustomQuoteService = { id: "extra", name: "Servicio adicional", unitCost: 25, unit, ...(["Por perfil", "Por evento"].includes(unit) ? { quantity: 3 } : {}) };
        const input = { ...individual, termMonths, rows };
        const before = priceQuote(input, config);
        const after = priceQuote({ ...input, customServices: [service] }, config);
        const margin = config.commercialMargin;
        const multiplier = unit === "Por equipo" ? 1 : unit === "Por año" ? termMonths / 12 / 5 : .6;
        const expected = calculateInstallment(new Decimal(25).mul(multiplier).div(new Decimal(1).minus(margin)), 0, config.monthlyPlacementRate, termMonths);
        for (let i = 0; i < rows.length; i++) {
          expect(new Decimal(after.results[i]!.canonUnitarioMensual).minus(before.results[i]!.canonUnitarioMensual).toNumber()).toBeCloseTo(rows[i]!.assetType === "Licenciamiento" ? 0 : expected.toNumber(), 10);
          expect(after.results[i]!.residual).toBe(0);
        }
        expect(new Decimal(after.totalMonthlyBeforeTax).minus(before.totalMonthlyBeforeTax).toNumber()).toBeCloseTo(expected.mul(5).toNumber(), 9);
      });
    }
  }
  it("agrega varios servicios al paquete sin sustituir su canon", () => {
    const config = noMandatory();
    const input = { packageType: "Básico" as const, termMonths: 36 as const, rows };
    const base = priceQuote(input, config);
    const withExtra = priceQuote({ ...input, customServices: [{ id: "extra", name: "Soporte", unit: "Por equipo", unitCost: 10 }] }, config);
    expect(withExtra.services.includedServices).toHaveLength(2);
    expect(Number(withExtra.totalMonthlyBeforeTax)).toBeGreaterThan(Number(base.totalMonthlyBeforeTax));
    expect(withExtra.services.customServices).toHaveLength(1);
    expect(config.individualServices).toHaveLength(14);
  });
  it("incluye obligatorios aunque el cliente los omita y usa el costo del catálogo", () => {
    const config = clonePricingConfig(DEFAULT_PRICING_CONFIG);
    const result = resolveQuoteServices({ ...individual, termMonths: 36 }, config, 10);
    expect(result.includedServices.map(row => row.id)).toEqual(config.individualServices.filter(row => row.mandatory).map(row => row.id));
    expect(result.serviceUnitCost.toNumber()).toBe(43);
    const selected = resolveQuoteServices({ ...individual, termMonths: 36, selectedServices: [{ id: "creacion-imagen", quantity: 2 }] }, config, 10);
    expect(selected.serviceUnitCost.toNumber()).toBe(51);
  });
  it("rechaza servicios inactivos, cantidades inválidas, duplicados y costos inválidos", () => {
    const config = noMandatory();
    config.individualServices[0]!.active = false;
    const invalidInputs: QuoteServiceInput[] = [
      { selectedServices: [{ id: "etiquetado" }] },
      { selectedServices: [{ id: "creacion-imagen" }] },
      { selectedServices: [{ id: "clonacion" }, { id: "clonacion" }] },
      ...[0, -1, 1.5, NaN].map(quantity => ({ customServices: [{ id: "extra", name: "Soporte", unit: "Por evento" as const, unitCost: 20, quantity }] })),
      { customServices: [{ id: "extra", name: "", unit: "Por equipo", unitCost: 20 }] },
      { customServices: [{ id: "extra", name: "Soporte", unit: "Por equipo", unitCost: 0 }] },
    ];
    for (const bad of invalidInputs)
      expect(() => resolveQuoteServices({ ...individual, termMonths: 36, ...bad }, config, 10)).toThrow(ServiceSelectionError);
  });
});
