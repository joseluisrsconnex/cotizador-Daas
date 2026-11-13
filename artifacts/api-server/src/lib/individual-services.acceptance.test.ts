import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { priceScenarios } from "./quote-scenarios";
import { resolveQuoteServices } from "./quote-services";
import { calculationConfig, commonRows } from "../test/fixtures/calculation-config";

const money = (actual: Decimal.Value, expected: number) =>
  expect(new Decimal(actual).toDecimalPlaces(2).minus(expected).abs().toNumber()).toBeLessThanOrEqual(.01);
export const individualInput = () => ({
  termMonths: 12 as const, terms: [12, 36, 60] as Array<12 | 36 | 60>,
  packageType: null, serviceMode: "Servicios individuales" as const,
  deliveryStatus: "Local" as const, rows: commonRows(),
  selectedServices: [
    { id: "mantenimiento-preventivo", events: [{ termMonths: 12 as const, quantity: 1 }, { termMonths: 36 as const, quantity: 3 }, { termMonths: 60 as const, quantity: 5 }] },
    { id: "logistica-salientes", quantity: 30 },
  ],
});

describe("Servicios individuales: casos A y B del documento, configuración fija", () => {
  const golden = [
    { term: 12, services: [4.2800, 1.4930, .7858], unit: [101.47, 92.01, 94.15], line: [5073.52, 3680.28, 470.75], total: 9224.56, licenseUnit: 10.45, licenseLine: 104.51, licensedTotal: 9329.07 },
    { term: 36, services: [1.7758, 1.8584, .3260], unit: [54.14, 48.94, 42.12], line: [2706.84, 1957.53, 210.60], total: 4874.96, licenseUnit: 4.34, licenseLine: 43.36, licensedTotal: 4918.32 },
    { term: 60, services: [1.3021, 2.2712, .2391], unit: [45.42, 40.96, 33.13], line: [2270.81, 1638.33, 165.63], total: 4074.77, licenseUnit: 3.18, licenseLine: 31.80, licensedTotal: 4106.57 },
  ];
  for (const expected of golden) it(`${expected.term} meses: importes A y B ±0,01 y filas físicas idénticas`, () => {
    const config = calculationConfig(), input = individualInput();
    const a = priceScenarios(input, config);
    const b = priceScenarios({ ...input, rows: [...input.rows, { assetType: "Licenciamiento", reference: "LIC-1", quantity: 10, unitCost: 100 }] }, config);
    const sa = a.scenarios.find(s => s.termMonths === expected.term)!;
    const sb = b.scenarios.find(s => s.termMonths === expected.term)!;
    expect(sb.results.slice(0, 3)).toEqual(sa.results);
    sa.results.forEach((row, i) => {
      money(row.canonUnitarioMensual, expected.unit[i]!);
      money(row.canonMensualTotal, expected.line[i]!);
      money(row.canonPaquetePorUnidad, expected.services.reduce((sum, v) => sum + v, 0));
    });
    money(sa.totalMonthlyBeforeTax, expected.total);
    money(sb.results[3]!.canonUnitarioMensual, expected.licenseUnit);
    money(sb.results[3]!.canonMensualTotal, expected.licenseLine);
    expect(sb.results[3]!.canonPaquetePorUnidad).toBe("0");
    expect(sb.results[3]!.residual).toBe(0);
    money(sb.totalMonthlyBeforeTax, expected.licensedTotal);
    money(a.forecast, 9224.56 * 12);
    money(b.forecast, 9329.07 * 12);
  });

  it("bloquea cada periodo sin mantenimientos y cada cantidad saliente ausente o inválida", () => {
    for (const term of [12, 36, 60]) {
      const input = individualInput();
      input.selectedServices[0]!.events = input.selectedServices[0]!.events!.filter(e => e.termMonths !== term);
      expect(() => priceScenarios(input, calculationConfig())).toThrow(`Indique el número de mantenimientos preventivos para el periodo de ${term} meses.`);
    }
    for (const quantity of [undefined, 0, -1, 1.5]) {
      const input = individualInput();
      input.selectedServices[1]!.quantity = quantity;
      expect(() => priceScenarios(input, calculationConfig())).toThrow("cantidad de equipos salientes");
    }
  });
  it("solo licenciamiento no aplica servicios ni obliga a indicar eventos", () => {
    const input = { ...individualInput(), rows: [{ assetType: "Licenciamiento" as const, reference: "LIC-1", quantity: 10, unitCost: 100 }], selectedServices: [{ id: "mantenimiento-preventivo" }, { id: "logistica-salientes" }] };
    const priced = priceScenarios(input, calculationConfig());
    expect(priced.services.includedServices).toEqual([]);
    expect(priced.scenarios.every(s => s.results[0]!.canonPaquetePorUnidad === "0")).toBe(true);
    money(priced.forecast, 104.51 * 12);
  });
  it("las dos operaciones salientes se distribuyen entre U, no entre licencias", () => {
    const input = { serviceMode: "Servicios individuales" as const, packageType: null, termMonths: 36 as const,
      selectedServices: [{ id: "borrado-seguro-salientes", quantity: 30 }] };
    const cost = resolveQuoteServices(input, calculationConfig(), 95).serviceUnitCost;
    expect(cost.toNumber()).toBeCloseTo(43 + 300 / 95, 12);
  });
});
