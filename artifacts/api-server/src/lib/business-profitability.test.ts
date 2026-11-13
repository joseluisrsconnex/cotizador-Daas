import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { priceScenarios } from "./quote-scenarios";
import { calculationConfig } from "../test/fixtures/calculation-config";
import { assertScenariosAllowed, publicScenarios } from "./business-profitability";
import { validatePricingConfig, type TermMonths } from "@workspace/pricing";

const money = (actual: Decimal.Value, expected: number) =>
  expect(new Decimal(actual).toDecimalPlaces(2).minus(expected).abs().toNumber()).toBeLessThanOrEqual(.01000001);
export const profitabilityInput = (termMonths: TermMonths = 36) => ({
  termMonths, terms: [termMonths], packageType: null, serviceMode: "Servicios individuales" as const,
  deliveryStatus: "Local" as const,
  rows: [{ assetType: "Laptop" as const, reference: "E14", quantity: 100, unitCost: 1500 }],
});

describe("Margen comercial y P&G: aceptación con configuración fija", () => {
  it("captación 0 y 0.008 cambia solo rentabilidad y bloquea el caso bajo mínimo", () => {
    const config = calculationConfig();
    const without = priceScenarios(profitabilityInput(), config);
    money(without.scenarios[0]!.profitability.fundingInterest!, 0);
    money(without.scenarios[0]!.profitability.operatingProfit!, 77945.45);
    expect(without.scenarios[0]!.profitability.monthlyFundingRate).toBe(0);
    config.monthlyFundingRate = .008;
    const withFunding = priceScenarios(profitabilityInput(), config);
    expect(withFunding.results).toEqual(without.results);
    expect(withFunding.totalMonthlyBeforeTax).toBe(without.totalMonthlyBeforeTax);
    expect(withFunding.forecast).toBe(without.forecast);
    const p = withFunding.scenarios[0]!.profitability;
    money(withFunding.results[0]!.canonUnitarioMensual, 63.85);
    money(p.fundingInterest!, 29032.72);
    money(p.operatingProfit!, 48912.73);
    money(p.netProfit, 31793.27);
    expect(p.monthlyFundingRate).toBe(.008);
    expect(p.netMargin).toBeCloseTo(.1244, 4);
    expect(p.status).toBe("Bajo mínimo");
    expect(() => assertScenariosAllowed(withFunding.scenarios)).toThrow("El escenario de 36 meses no cumple las condiciones comerciales.");
    expect(JSON.stringify(publicScenarios(withFunding.scenarios, false))).not.toMatch(/monthlyFundingRate|fundingInterest|operatingProfit/);
  });
  it("valida captación entre 0 y 10 % sin admitir parámetros ausentes", () => {
    for (const rate of [-.000001, .100001, NaN, undefined]) {
      expect(() => validatePricingConfig({ ...calculationConfig(), monthlyFundingRate: rate as number })).toThrow("captación");
    }
    for (const rate of [0, .008, .1]) {
      expect(() => validatePricingConfig({ ...calculationConfig(), monthlyFundingRate: rate })).not.toThrow();
    }
  });
  it("fondeo toma el residual del costo con spare y extensión, sin residual de servicios ni licencias", () => {
    const config = calculationConfig();
    config.monthlyFundingRate = .008;
    const input = { ...profitabilityInput(), terms: [36, 48] as TermMonths[], rows: [
      { ...profitabilityInput().rows[0]!, warrantyExtensions: [{ termMonths: 48 as const, unitCost: 90 }] },
      { assetType: "Licenciamiento" as const, reference: "LIC", quantity: 3, unitCost: 200 },
    ], customServices: [{ id: "perfil", name: "Perfil", unit: "Por perfil" as const, quantity: 2, unitCost: 300 }] };
    const p = priceScenarios(input, config).scenarios[1]!.profitability;
    const capital = new Decimal(p.totalCost);
    // Laptop at 48 months: (1500 + 90), spare base 35, quantity 100, residual 8%.
    const finalBalance = new Decimal(1590).plus(new Decimal(1590).div(35).mul(100).div(35)).mul(100).mul(.08);
    const growth = new Decimal(1.008).pow(48);
    const installment = capital.mul(growth).minus(finalBalance).mul(.008).div(growth.minus(1));
    money(p.fundingInterest!, installment.mul(48).plus(finalBalance).minus(capital).toNumber());
  });
  for (const [term, unit, total, revenue, net, margin, status] of [
    [12, 127.57, 12757.20, 204321.68, 18405.55, .0901, "Bajo mínimo"],
    [24, 81.46, 8146.08, 229662.79, 34383.12, .1497, "En objetivo"],
    [36, 63.85, 6385.23, 255485.82, 50664.54, .1983, "Rentable"],
    [48, 55.43, 5543.27, 279739.50, 65956.48, .2358, "Rentable"],
    [60, 50.43, 5043.32, 302599.45, 80369.68, .2656, "Rentable"],
  ] as const) it(`${term} meses: precio y rentabilidad solicitados`, () => {
    const s = priceScenarios(profitabilityInput(term), calculationConfig()).scenarios[0]!;
    money(s.results[0]!.canonUnitarioMensual, unit);
    money(s.totalMonthlyBeforeTax, total);
    money(s.profitability.revenue, revenue);
    money(s.profitability.netProfit, net);
    expect(Math.abs(s.profitability.netMargin - margin)).toBeLessThanOrEqual(.0001);
    expect(s.profitability.status).toBe(status);
    expect(s.profitability.commercialMargin).toBe(.05);
    if (term === 12) expect(() => assertScenariosAllowed([s])).toThrow("El escenario de 12 meses no cumple las condiciones comerciales. Retírelo o contacte con un administrador.");
    else expect(() => assertScenariosAllowed([s])).not.toThrow();
  });
  it("36 meses: costos e intermedios P&G sin redondeo de cálculo", () => {
    const p = priceScenarios(profitabilityInput(), calculationConfig()).scenarios[0]!.profitability;
    const cost = new Decimal(p.totalCost), revenue = new Decimal(p.revenue);
    money(cost, 166544.90);
    money(revenue.mul(.01), 2554.86);
    money(cost.mul(.04), 6661.80);
    money(revenue.minus(cost).mul(.02), 1778.82);
    money(new Decimal(p.netProfit).div(.65), 77945.45);
  });
  it("36 y 48 juntos: extensión antes de spare y rentabilidad por escenario", () => {
    const input = profitabilityInput();
    const priced = priceScenarios({ ...input, terms: [36, 48], rows: [
      { ...input.rows[0]!, warrantyExtensions: [{ termMonths: 48, unitCost: 90 }] },
    ] }, calculationConfig());
    money(priced.scenarios[0]!.totalMonthlyBeforeTax, 6385.23);
    money(priced.scenarios[1]!.results[0]!.canonUnitarioMensual, 58.67);
    money(priced.scenarios[1]!.totalMonthlyBeforeTax, 5867.01);
    expect(priced.scenarios[1]!.profitability.netMargin).toBeCloseTo(.2358, 4);
  });
  it("bajo objetivo permite guardar; los umbrales no modifican el precio", () => {
    const config = calculationConfig();
    const before = priceScenarios(profitabilityInput(24), config);
    config.margins.find(m => m.termMonths === 24)!.target = .16;
    const after = priceScenarios(profitabilityInput(24), config);
    expect(after.scenarios[0]!.profitability.status).toBe("Bajo objetivo");
    expect(after.totalMonthlyBeforeTax).toBe(before.totalMonthlyBeforeTax);
    expect(() => assertScenariosAllowed(after.scenarios)).not.toThrow();
  });
  it("elimina toda rentabilidad de la respuesta comercial y conserva la administrativa", () => {
    const scenarios = priceScenarios(profitabilityInput(), calculationConfig()).scenarios;
    expect(publicScenarios(scenarios, false)[0]).toEqual({
      termMonths: 36, results: scenarios[0]!.results, totalMonthlyBeforeTax: scenarios[0]!.totalMonthlyBeforeTax,
    });
    expect(JSON.stringify(publicScenarios(scenarios, false))).not.toMatch(/profitability|commercialMargin|netMargin|netProfit|totalCost|status/);
    expect(publicScenarios(scenarios, true)[0]!.profitability).toEqual(scenarios[0]!.profitability);
  });
  it("los históricos sin evaluación no se recalculan ni se bloquean", () => {
    const legacy = [{ termMonths: 12, results: [], totalMonthlyBeforeTax: "1234.56" }];
    expect(() => assertScenariosAllowed(legacy)).not.toThrow();
    expect(publicScenarios(legacy, true)).toEqual(legacy);
  });
  it("costo total suma cada unidad de servicio y los activos/licencias, sin residual de servicios", () => {
    const priced = priceScenarios({ ...profitabilityInput(), rows: [
      { assetType: "Laptop", reference: "Físico", quantity: 2, unitCost: 100 },
      { assetType: "Licenciamiento", reference: "Licencia", quantity: 3, unitCost: 100 },
    ], customServices: [
      { id: "perfil", name: "Perfil", unit: "Por perfil", quantity: 3, unitCost: 20 },
      { id: "evento", name: "Evento", unit: "Por evento", quantity: 2, unitCost: 30 },
      { id: "anual", name: "Anual", unit: "Por año", unitCost: 40 },
      { id: "saliente", name: "Saliente", unit: "Por equipo saliente", quantity: 4, unitCost: 10 },
      { id: "mtto", name: "Mantenimiento", unit: "Por equipo por evento", unitCost: 5,
        events: [{ termMonths: 36, quantity: 3 }] },
    ] }, calculationConfig());
    const p = priced.scenarios[0]!.profitability;
    const assetCost = new Decimal(100).mul(new Decimal(1).plus(new Decimal(1).div(35))).mul(2)
      .plus(new Decimal(100).mul("1.05").mul(3));
    const serviceCost = 43 * 2 + 20 * 3 + 30 * 2 + 40 * 3 + 10 * 4 + 5 * 2 * 3;
    expect(new Decimal(p.totalCost).minus(assetCost.plus(serviceCost)).abs().toNumber()).toBeLessThan(1e-10);
    const recovery = assetCost.minus(315).div(.95).mul(.15);
    expect(new Decimal(p.revenue).minus(new Decimal(priced.totalMonthlyBeforeTax).mul(36).plus(recovery)).abs().toNumber()).toBeLessThan(1e-10);
  });
  it("valida Mínimo ≤ Objetivo ≤ Rentable y el margen comercial 0 a 0,5", () => {
    for (const m of [-.01, .50001, NaN]) {
      const c = calculationConfig(); c.commercialMargin = m;
      expect(() => validatePricingConfig(c)).toThrow("margen comercial");
    }
    const c = calculationConfig(); c.margins[0]!.profitable = .11;
    expect(() => validatePricingConfig(c)).toThrow("Rentable");
  });
});
