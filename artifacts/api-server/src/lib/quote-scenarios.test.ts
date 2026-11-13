import { describe, expect, it } from "vitest";
import { clonePricingConfig, DEFAULT_PRICING_CONFIG, type TermMonths } from "@workspace/pricing";
import { priceQuote, QUOTE_UNAVAILABLE } from "./quote-pricing";
import { priceScenarios, scenarioTerms, ScenarioInputError } from "./quote-scenarios";
import { contractForecast } from "./quote-forecast";

const input = {
  termMonths: 12 as const, terms: [12, 24, 36, 48, 60] as TermMonths[],
  deliveryStatus: "Local" as const, packageType: "Básico" as const,
  rows: [
    { assetType: "Laptop" as const, reference: "Laptop A", quantity: 40, unitCost: 1000,
      warrantyExtensions: [{ termMonths: 24 as const, unitCost: 0 }, { termMonths: 36 as const, unitCost: 80 },
        { termMonths: 48 as const, unitCost: 140 }, { termMonths: 60 as const, unitCost: 200 }] },
    { assetType: "Licenciamiento" as const, reference: "Licencia B", quantity: 5, unitCost: 100,
      warrantyExtensions: [{ termMonths: 24 as const, unitCost: 0 }, { termMonths: 36 as const, unitCost: 0 },
        { termMonths: 48 as const, unitCost: 0 }, { termMonths: 60 as const, unitCost: 0 }] },
  ],
};

describe("Escenarios por plazo y extensión de garantía", () => {
  it("Licenciamiento no exige ni financia extensiones, sin eximir a los equipos físicos", () => {
    const license = { assetType: "Licenciamiento" as const, reference: "Licencia", quantity: 5, unitCost: 100 };
    const draft = { ...input, terms: [12, 36] as TermMonths[], rows: [license] };
    const result = priceScenarios(draft, DEFAULT_PRICING_CONFIG);
    expect(result.scenarios).toHaveLength(2);
    const staleExtensions = priceScenarios({
      ...draft, rows: [{ ...license, warrantyExtensions: [{ termMonths: 36, unitCost: 500 }] }],
    }, DEFAULT_PRICING_CONFIG);
    expect(staleExtensions.scenarios).toEqual(result.scenarios);
    const physical = { ...license, assetType: "Laptop" as const, reference: "Equipo físico" };
    expect(() => priceScenarios({ ...draft, rows: [license, physical] }, DEFAULT_PRICING_CONFIG))
      .toThrow("Indique el costo de extensión de garantía a 36 meses para Equipo físico.");
  });
  it("calcula cada escenario con su costo ampliado, spare, residual, objetivo y servicios", () => {
    const config = clonePricingConfig(DEFAULT_PRICING_CONFIG);
    const result = priceScenarios(input, config);
    expect(result.scenarios).toHaveLength(5);
    for (const scenario of result.scenarios) {
      const expected = priceQuote({
        ...input, termMonths: scenario.termMonths,
        rows: input.rows.map(row => ({ ...row, unitCost: row.unitCost +
          (row.warrantyExtensions.find(item => item.termMonths === scenario.termMonths)?.unitCost ?? 0) })),
      }, config);
      expect(scenario.results).toEqual(expected.results);
      expect(scenario.totalMonthlyBeforeTax).toBe(expected.totalMonthlyBeforeTax);
      expect(scenario.results[0]!.residual).toBe(config.residuals.find(row => row.termMonths === scenario.termMonths)!.assets.find(row => row.assetType === "Laptop")!.fraction);
    }
    expect(result.results).toEqual(result.scenarios[0]!.results);
    expect(result.totalMonthlyBeforeTax).toBe(result.scenarios[0]!.totalMonthlyBeforeTax);
    expect(result.forecast).toBe(contractForecast(result.scenarios));
  });
  it("un plazo usa el costo base y el estado de entrega no altera ningún importe", () => {
    const single = { ...input, terms: [12] as TermMonths[], rows: input.rows.map(({ warrantyExtensions: _extensions, ...row }) => row) };
    const local = priceScenarios(single, DEFAULT_PRICING_CONFIG);
    const cto = priceScenarios({ ...single, deliveryStatus: "CTO" }, DEFAULT_PRICING_CONFIG);
    expect(local).toEqual(cto);
    expect(local.scenarios).toHaveLength(1);
  });
  it("diferencia costo cero explícito de extensión omitida y da el mensaje exacto", () => {
    const missing = { ...input, rows: [{ ...input.rows[0], warrantyExtensions: [] }] };
    expect(() => priceScenarios(missing, DEFAULT_PRICING_CONFIG)).toThrow("Indique el costo de extensión de garantía a 24 meses para Laptop A.");
    expect(() => priceScenarios(input, DEFAULT_PRICING_CONFIG)).not.toThrow();
  });
  it("bloquea toda la cotización si el objetivo no alcanza el mínimo de un escenario", () => {
    const config = clonePricingConfig(DEFAULT_PRICING_CONFIG);
    config.margins.find(row => row.termMonths === 60)!.target = .01;
    expect(() => priceScenarios(input, config)).toThrow(QUOTE_UNAVAILABLE);
  });
  it("rechaza selección vacía, repetida, base incorrecta, estado vacío y extensiones inválidas", () => {
    for (const terms of [[], [12, 12], [24, 36]] as TermMonths[][])
      expect(() => scenarioTerms({ ...input, terms })).toThrow(ScenarioInputError);
    expect(scenarioTerms({ ...input, terms: [60, 12, 36] })).toEqual([12, 36, 60]);
    expect(() => priceScenarios({ ...input, deliveryStatus: "" as "Local" }, DEFAULT_PRICING_CONFIG)).toThrow(ScenarioInputError);
    for (const unitCost of [-1, NaN, Infinity]) {
      expect(() => priceScenarios({ ...input, rows: [{ ...input.rows[0], warrantyExtensions: [{ termMonths: 24, unitCost }] }] }, DEFAULT_PRICING_CONFIG)).toThrow(ScenarioInputError);
    }
  });
});
