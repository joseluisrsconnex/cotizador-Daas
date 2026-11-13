import Decimal from "decimal.js";

/** Internal contract value, using only the saved pre-tax canon of the shortest term. */
export function contractForecast(scenarios: ReadonlyArray<{ termMonths: number; totalMonthlyBeforeTax: string }>): string {
  const shortest = [...scenarios].sort((a, b) => a.termMonths - b.termMonths)[0];
  if (!shortest) throw new Error("Forecast requiere al menos un escenario.");
  return new Decimal(shortest.totalMonthlyBeforeTax)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP).times(shortest.termMonths).toFixed(2);
}
