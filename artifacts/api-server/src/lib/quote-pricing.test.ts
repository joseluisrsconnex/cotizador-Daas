import { describe, expect, it } from "vitest";
import { clonePricingConfig, DEFAULT_PRICING_CONFIG } from "@workspace/pricing";
import { getAppliedMargin, priceQuote, QUOTE_UNAVAILABLE, QuotePricingError } from "./quote-pricing";

const draft = {
  termMonths: 36 as const,
  packageType: "Básico" as const,
  rows: [{ assetType: "Laptop" as const, reference: "Equipo A", quantity: 31, unitCost: 1200 }],
};

describe("Política de cotización del servidor", () => {
  it("aplica siempre el margen comercial, sin parámetro del navegador", () => {
    const config = clonePricingConfig(DEFAULT_PRICING_CONFIG);
    expect(getAppliedMargin(config, 36)).toBe(config.commercialMargin);
    const priced = priceQuote(draft, config);
    expect(priced.margin).toBe(.05);
    expect(Number(priced.results[0].canonUnitarioMensual)).toBeGreaterThan(0);
  });

  it("Rentable y el catálogo individual no intervienen en el cálculo del modo Paquete", () => {
    const config = clonePricingConfig(DEFAULT_PRICING_CONFIG);
    const before = priceQuote(draft, config);
    config.margins.forEach(row => { row.profitable = .85; });
    config.individualServices.forEach(row => { row.unitCost = 999; row.active = false; });
    expect(priceQuote(draft, config).results).toEqual(before.results);
    expect(priceQuote(draft, config).totalMonthlyBeforeTax).toEqual(before.totalMonthlyBeforeTax);
  });

  it("rechaza el objetivo inferior al mínimo sin divulgar parámetros", () => {
    const config = clonePricingConfig(DEFAULT_PRICING_CONFIG);
    config.margins.find(row => row.termMonths === 36)!.target = .13;
    expect(() => priceQuote(draft, config)).toThrowError(QUOTE_UNAVAILABLE);
    try { priceQuote(draft, config); }
    catch (error) { expect(error).toMatchObject({ status: 422, message: QUOTE_UNAVAILABLE }); }
  });

  it("devuelve 422 genérico si el margen comercial resulta inválido", () => {
    const config = clonePricingConfig(DEFAULT_PRICING_CONFIG);
    config.commercialMargin = .50001;
    expect(() => priceQuote(draft, config)).toThrowError(QuotePricingError);
    try { priceQuote(draft, config); }
    catch (error) {
      expect(error).toMatchObject({ status: 422, message: QUOTE_UNAVAILABLE });
      expect(QUOTE_UNAVAILABLE.toLowerCase()).not.toContain("margen");
    }
  });

  it("devuelve 422 cuando una configuración persistida tiene un mínimo negativo o inválido", () => {
    const config = clonePricingConfig(DEFAULT_PRICING_CONFIG);
    config.margins.find(row => row.termMonths === 36)!.minimum = -.01;
    expect(() => priceQuote(draft, config)).toThrowError(QuotePricingError);
    try { priceQuote(draft, config); }
    catch (error) { expect(error).toMatchObject({ status: 422, message: QUOTE_UNAVAILABLE }); }
  });

  it("resuelve cada residual según activo y periodo y el paquete conserva residual cero", () => {
    for (const term of [12, 36] as const) {
      const priced = priceQuote({ ...draft, termMonths: term }, DEFAULT_PRICING_CONFIG);
      expect(priced.results[0].residual).toBe(term === 12 ? .3 : .15);
      expect(Number(priced.results[0].canonPaquetePorUnidad)).toBeGreaterThan(0);
    }
  });
});
