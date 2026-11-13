import Decimal from "decimal.js";
import type { PricingConfig } from "./pricing";

/** Storage precision only. This does not change any calculation formula. */
export function roundFraction(value: number): number {
  return new Decimal(value).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toNumber();
}

export function percentToFraction(value: string | number): number {
  return new Decimal(value).div(100).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toNumber();
}

export function normalizePricingConfig(config: PricingConfig): PricingConfig {
  return {
    ...config,
    commercialMargin: roundFraction(config.commercialMargin),
    profitAndLoss: Object.fromEntries(Object.entries(config.profitAndLoss).map(([key, value]) => [key, roundFraction(value)])) as PricingConfig["profitAndLoss"],
    monthlyPlacementRate: roundFraction(config.monthlyPlacementRate),
    monthlyFundingRate: roundFraction(config.monthlyFundingRate),
    residuals: config.residuals.map(group => ({
      ...group, assets: group.assets.map(asset => ({ ...asset, fraction: roundFraction(asset.fraction) })),
    })),
    margins: config.margins.map(margin => ({
      ...margin, target: roundFraction(margin.target), minimum: roundFraction(margin.minimum),
      profitable: roundFraction(margin.profitable),
    })),
  };
}
