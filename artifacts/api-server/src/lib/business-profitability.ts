import Decimal from "decimal.js";
import type { PricingConfig, TermMonths } from "@workspace/pricing";
import type { ScenarioProfitability } from "@workspace/api-zod";
export type { ScenarioProfitability } from "@workspace/api-zod";

const Exact = Decimal.clone({ precision: 48, rounding: Decimal.ROUND_HALF_UP });
export type MarginStatus = "Bajo mínimo" | "Bajo objetivo" | "En objetivo" | "Rentable";

export function businessProfitability(term: TermMonths, monthly: Decimal.Value, cost: Decimal.Value,
  recovery: Decimal.Value, config: PricingConfig): ScenarioProfitability {
  const p = config.profitAndLoss;
  const revenue = new Exact(monthly).mul(term).plus(recovery);
  const totalCost = new Exact(cost);
  const fundingRate = new Exact(config.monthlyFundingRate);
  // Recovery uses sale value; remove only its commercial margin to obtain
  // the cost-based residual, including spare and extensions but no services.
  const finalBalance = new Exact(recovery).mul(new Exact(1).minus(config.commercialMargin));
  const growth = new Exact(1).plus(fundingRate).pow(term);
  const fundingPayment = fundingRate.isZero() ? totalCost.minus(finalBalance).div(term)
    : totalCost.mul(growth).minus(finalBalance).mul(fundingRate).div(growth.minus(1));
  const fundingInterest = fundingRate.isZero() ? new Exact(0)
    : fundingPayment.mul(term).plus(finalBalance).minus(totalCost);
  const operatingProfit = revenue.minus(totalCost).minus(fundingInterest).minus(revenue.mul(p.ica))
    .minus(totalCost.mul(new Exact(p.maintenance).plus(p.insurance)))
    .minus(revenue.minus(totalCost).mul(p.badDebt));
  const netProfit = operatingProfit.mul(new Exact(1).minus(p.incomeTax));
  const netMargin = revenue.isZero() ? new Exact(0) : netProfit.div(revenue);
  const thresholds = config.margins.find(row => row.termMonths === term)!;
  const status: MarginStatus = netMargin.lt(thresholds.minimum) ? "Bajo mínimo" :
    netMargin.lt(thresholds.target) ? "Bajo objetivo" : netMargin.gte(thresholds.profitable) ? "Rentable" : "En objetivo";
  return { commercialMargin: config.commercialMargin, revenue: revenue.toString(), totalCost: totalCost.toString(),
    monthlyFundingRate: config.monthlyFundingRate, fundingInterest: fundingInterest.toString(), operatingProfit: operatingProfit.toString(),
    netProfit: netProfit.toString(), netMargin: netMargin.toNumber(), status };
}

export const blockedScenarioMessage = (term: number) =>
  `El escenario de ${term} meses no cumple las condiciones comerciales. Retírelo o contacte con un administrador.`;

export function scenarioBlockingErrors(scenarios: Array<{ termMonths: number; profitability?: ScenarioProfitability }>) {
  return scenarios.filter(s => s.profitability?.status === "Bajo mínimo").map(s => blockedScenarioMessage(s.termMonths));
}

/** Stored profitability only: never reprice an old version or use today's thresholds. */
export function assertScenariosAllowed(scenarios: unknown) {
  if (!Array.isArray(scenarios)) return;
  const message = scenarioBlockingErrors(scenarios)[0];
  if (message) throw new BusinessConditionsError(message);
}
export class BusinessConditionsError extends Error { readonly status = 422; }

/** Whitelist the public scenario rather than spreading confidential persisted fields. */
export function publicScenarios<T extends { termMonths: number; results: unknown; totalMonthlyBeforeTax: string; profitability?: ScenarioProfitability }>(
  scenarios: T[], isAdmin: boolean,
) {
  return scenarios.map(s => ({
    termMonths: s.termMonths, results: s.results, totalMonthlyBeforeTax: s.totalMonthlyBeforeTax,
    ...(isAdmin && s.profitability ? { profitability: s.profitability } : {}),
  }));
}
