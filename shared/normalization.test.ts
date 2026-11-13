import { describe, expect, it } from "vitest";
import { clonePricingConfig, DEFAULT_PRICING_CONFIG } from "./pricing";
import { normalizePricingConfig, percentToFraction, roundFraction } from "./normalization";

describe("Precisión de porcentajes al guardar", () => {
  it("2 % es exactamente 0.02, también después de serializar JSON", () => {
    expect(percentToFraction("2")).toBe(0.02);
    expect(percentToFraction(2.00000000000002)).toBe(0.02);
    expect(JSON.stringify(percentToFraction("2"))).toBe("0.02");
    expect(roundFraction(0.0200000000000002)).toBe(0.02);
  });
  it("tasa, residuales y márgenes se normalizan a seis decimales sin mutar el snapshot", () => {
    const config = clonePricingConfig(DEFAULT_PRICING_CONFIG);
    config.monthlyPlacementRate = 0.0200000000000002;
    config.monthlyFundingRate = 0.0081234567;
    config.residuals[0]!.assets[0]!.fraction = 0.12345678;
    config.margins[0]!.target = 0.150000000000002;
    config.margins[0]!.minimum = 0.10000000000000002;
    config.margins[0]!.profitable = 0.18000000000000002;
    const original = structuredClone(config);
    const result = normalizePricingConfig(config);
    expect(result.monthlyPlacementRate).toBe(0.02);
    expect(result.monthlyFundingRate).toBe(0.008123);
    expect(result.residuals[0]!.assets[0]!.fraction).toBe(0.123457);
    expect(result.margins[0]!.target).toBe(0.15);
    expect(result.margins[0]!.minimum).toBe(0.10);
    expect(result.margins[0]!.profitable).toBe(0.18);
    expect(result.spareBases).toEqual(config.spareBases);
    expect(result.servicePackages).toEqual(config.servicePackages);
    expect(config).toEqual(original);
    expect(normalizePricingConfig(result)).toEqual(result);
  });
});
