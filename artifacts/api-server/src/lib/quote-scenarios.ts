import Decimal from "decimal.js";
import { TERM_MONTHS, type PricingConfig, type QuoteLineInput, type QuoteServiceInput, type ServicePackageType, type TermMonths } from "@workspace/pricing";
import { priceQuote } from "./quote-pricing";
import { contractForecast } from "./quote-forecast";

export class ScenarioInputError extends Error { readonly status = 400; }
export interface ScenarioInput extends QuoteServiceInput {
  termMonths: TermMonths;
  terms?: TermMonths[];
  packageType: ServicePackageType | null;
  deliveryStatus: "Local" | "CTO";
  rows: QuoteLineInput[];
}

export function scenarioTerms(input: Pick<ScenarioInput, "termMonths" | "terms">): TermMonths[] {
  const terms = input.terms ?? [input.termMonths];
  if (!terms.length || terms.length > 5 || new Set(terms).size !== terms.length ||
    terms.some(term => !TERM_MONTHS.includes(term)))
    throw new ScenarioInputError("Seleccione al menos un periodo válido, sin repetir.");
  const sorted = [...terms].sort((a, b) => a - b);
  if (input.termMonths !== sorted[0]) throw new ScenarioInputError("El periodo base debe ser el más corto seleccionado.");
  return sorted;
}

/** Warranty extension is added before spare, residual and margin are applied. */
export function priceScenarios(input: ScenarioInput, config: PricingConfig) {
  if (!["Local", "CTO"].includes(input.deliveryStatus))
    throw new ScenarioInputError("Seleccione el estado de entrega de los activos.");
  const terms = scenarioTerms(input);
  for (const row of input.rows) {
    if (row.assetType === "Licenciamiento") continue;
    const extensions = row.warrantyExtensions ?? [];
    if (new Set(extensions.map(item => item.termMonths)).size !== extensions.length ||
      extensions.some(item => !TERM_MONTHS.includes(item.termMonths) || !Number.isFinite(item.unitCost) || item.unitCost < 0))
      throw new ScenarioInputError("Revise los costos de extensión de garantía.");
    for (const term of terms.slice(1)) {
      if (!extensions.some(item => item.termMonths === term))
        throw new ScenarioInputError(`Indique el costo de extensión de garantía a ${term} meses para ${row.reference}.`);
    }
  }
  const priced = terms.map(termMonths => {
    const rows = input.rows.map(row => ({
      ...row,
      unitCost: new Decimal(row.unitCost).plus(row.assetType === "Licenciamiento" || termMonths === terms[0] ? 0 :
        row.warrantyExtensions!.find(item => item.termMonths === termMonths)!.unitCost).toNumber(),
    }));
    return { termMonths, ...priceQuote({ ...input, termMonths, rows }, config) };
  });
  const base = priced[0]!;
  return {
    ...base, terms, forecast: contractForecast(priced),
    scenarios: priced.map(({ termMonths, results, totalMonthlyBeforeTax, profitability }) => ({ termMonths, results, totalMonthlyBeforeTax, profitability })),
  };
}
