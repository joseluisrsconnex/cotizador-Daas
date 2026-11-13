import { createHash } from "node:crypto";
import { calculateQuote, validatePricingConfig, type PricingConfig, type QuoteLineInput, type ServicePackageType, type TermMonths } from "@workspace/pricing";
import type { QuoteServiceInput } from "@workspace/pricing";
import { resolveQuoteServices } from "./quote-services";
import { businessProfitability } from "./business-profitability";

export const QUOTE_UNAVAILABLE = "No es posible generar la cotización con los parámetros actuales. Contacte con un administrador.";

export class QuotePricingError extends Error {
  readonly status = 422;
  constructor(readonly detail: string) {
    super(QUOTE_UNAVAILABLE);
    this.name = "QuotePricingError";
  }
}

/** Never accept an applied margin from a browser request. */
export function getAppliedMargin(config: PricingConfig, termMonths: TermMonths): number {
  if (!config.margins.some(item => item.termMonths === termMonths))
    throw new QuotePricingError(`No existe configuración para ${termMonths} meses.`);
  if (!Number.isFinite(config.commercialMargin) || config.commercialMargin < 0 || config.commercialMargin > 0.5)
    throw new QuotePricingError("Margen comercial inválido.");
  return config.commercialMargin;
}

export function quoteConfigRevision(config: unknown): string {
  // Historical snapshots intentionally retain older schemas; never parse them as today's config.
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, canonical(nested)])) : value;
  return createHash("sha256").update(JSON.stringify(canonical(config))).digest("hex");
}

export function priceQuote(
  input: QuoteServiceInput & { termMonths: TermMonths; packageType: ServicePackageType | null; rows: QuoteLineInput[] },
  config: PricingConfig,
) {
  try { validatePricingConfig(config); }
  catch (error) { throw new QuotePricingError(`Configuración incompleta: ${error instanceof Error ? error.message : "error desconocido"}`); }
  const margin = getAppliedMargin(config, input.termMonths);
  const { serviceUnitCost, ...services } = resolveQuoteServices(input, config, input.rows.reduce((sum, row) => sum + (row.assetType === "Licenciamiento" ? 0 : row.quantity), 0));
  try {
    const calculation = calculateQuote({ ...input, serviceUnitCost, margin }, config);
    return {
      margin,
      profitability: businessProfitability(input.termMonths, calculation.totalMonthlyBeforeTax,
        calculation.totalCost, calculation.residualRecovery, config),
      services,
      results: calculation.rows.map(row => ({
        ...row,
        canonUnitarioMensual: row.canonUnitarioMensual.toString(),
        canonMensualTotal: row.canonMensualTotal.toString(),
        canonProducto: row.canonProducto.toString(),
        canonPaquetePorUnidad: row.canonPaquetePorUnidad.toString(),
      })),
      totalMonthlyBeforeTax: calculation.totalMonthlyBeforeTax.toString(),
    };
  } catch (error) {
    throw new QuotePricingError(`Cálculo fallido (${input.termMonths} meses): ${error instanceof Error ? error.message : "error desconocido"}`);
  }
}
