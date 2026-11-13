import Decimal from "decimal.js";
import type { QuoteResultRow, QuoteScenario, SavedQuote, TermMonths } from "@workspace/api-client-react";

export const toCalculatedRows = (results: QuoteResultRow[]) => results.map(row => ({
  ...row,
  canonUnitarioMensual: new Decimal(row.canonUnitarioMensual),
  canonMensualTotal: new Decimal(row.canonMensualTotal),
  canonProducto: new Decimal(row.canonProducto),
  canonPaquetePorUnidad: new Decimal(row.canonPaquetePorUnidad),
}));

/** Server-calculated scenario converted to exact Decimal amounts for display/export. */
export const toScenario = (scenario: QuoteScenario) => ({
  termMonths: scenario.termMonths,
  calculatedRows: toCalculatedRows(scenario.results),
  total: new Decimal(scenario.totalMonthlyBeforeTax),
});

/** Stored historical amounts are restored verbatim, never recalculated with today's settings. */
export function restoreSavedQuote(quote: SavedQuote) {
  const scenarios = (quote.scenarios?.length
    ? quote.scenarios
    : [{ termMonths: quote.termMonths, results: quote.results, totalMonthlyBeforeTax: quote.totalMonthlyBeforeTax }]).map(toScenario);
  const terms: TermMonths[] = quote.terms?.length ? quote.terms : [quote.termMonths];
  return {
    customer: quote.customer, quoteCode: quote.quoteCode, term: quote.termMonths, terms, packageType: quote.packageType,
    serviceMode: quote.serviceMode, includedServices: quote.includedServices,
    deliveryStatus: quote.deliveryStatus ?? "",
    // Client-facing views never carry warranty extension costs.
    rows: quote.rows.map(({ warrantyExtensions: _omit, ...row }) => row),
    createdAt: quote.createdAt, versionNumber: quote.versionNumber,
    calculatedRows: toCalculatedRows(quote.results),
    total: new Decimal(quote.totalMonthlyBeforeTax),
    scenarios,
  };
}
