import { describe, expect, it } from "vitest";
import { contractForecast } from "./quote-forecast";

describe("Forecast interno del contrato", () => {
  it("elige 36 entre 36 y 48 meses, sin importar el orden", () => {
    expect(contractForecast([
      { termMonths: 48, totalMonthlyBeforeTax: "5543.27" },
      { termMonths: 36, totalMonthlyBeforeTax: "6385.23" },
    ])).toBe("229868.28");
  });
  it("multiplica el único canon de 12 meses", () => {
    expect(contractForecast([{ termMonths: 12, totalMonthlyBeforeTax: "12757.20" }])).toBe("153086.40");
  });
  it("redondea el canon antes de multiplicar, sin modificar los escenarios", () => {
    const scenarios = [{ termMonths: 36, totalMonthlyBeforeTax: "6385.235" }];
    const before = structuredClone(scenarios);
    expect(contractForecast(scenarios)).toBe("229868.64");
    expect(scenarios).toEqual(before);
  });
});
