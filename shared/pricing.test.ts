import assert from "node:assert/strict";
import { describe, expect, it, test } from "vitest";
import {
  ASSET_TYPES,
  TERM_MONTHS,
  SERVICE_PACKAGE_TYPES,
  DEFAULT_PRICING_CONFIG as CURRENT_PRICING_CONFIG,
  calculateInstallment,
  calculateQuote,
  clonePricingConfig,
  validatePricingConfig,
  type CalculatedQuoteLine,
  type QuoteLineInput,
  type TermMonths,
} from "./pricing.ts";

// Package fixtures cover the legacy input path with today's commercial pricing policy.
const DEFAULT_PRICING_CONFIG = clonePricingConfig(CURRENT_PRICING_CONFIG);
DEFAULT_PRICING_CONFIG.servicePackages.forEach((item, index) => { item.unitCost = [35, 50, 70][index]; });

test("La cuota coincide con la expresión PMT indicada", () => {
  for (const term of TERM_MONTHS) {
    const pv = 1234.567;
    const residual = 0.15;
    const rate = 0.02;
    const compound = (1 + rate) ** term;
    const expected = (pv * compound - pv * residual) * rate / (compound - 1);
    const actual = calculateInstallment(pv, residual, rate, term).toNumber();
    assert.ok(Math.abs(actual - expected) < 1e-10);
  }
});

test("Spare, venta y canon coinciden en todos los periodos, tipos y paquetes", () => {
  const config = DEFAULT_PRICING_CONFIG;
  for (const term of TERM_MONTHS) {
    const margin = config.commercialMargin;
    const rate = config.monthlyPlacementRate;
    const compound = (1 + rate) ** term;
    const cuota = (pv: number, residual: number) =>
      (pv * compound - pv * residual) * rate / (compound - 1);
    for (const assetType of ASSET_TYPES) {
      const base = config.spareBases.find((item) => item.assetType === assetType)!.units;
      const residual = config.residuals.find((item) => item.termMonths === term)!
        .assets.find((item) => item.assetType === assetType)!.fraction;
      for (const quantity of [1, base, base + 1, base * 2]) {
        for (const packageType of SERVICE_PACKAGE_TYPES) {
          const unitCost = 999.995;
          const costSpare = unitCost / base;
          const costWithSpare = unitCost + (quantity <= base ? costSpare : costSpare * quantity / base);
          const saleValue = costWithSpare / (1 - margin) * quantity;
          const packageCost = config.servicePackages.find((item) => item.packageType === packageType)!.unitCost;
          const expectedUnit = cuota(saleValue, residual) / quantity + (assetType === "Licenciamiento" ? 0 : cuota(packageCost / (1 - margin), 0));
          const result = calculateQuote({
            termMonths: term,
            packageType,
            margin,
            rows: [{ assetType, reference: "Referencia", quantity, unitCost }],
          }, config);
          assert.ok(Math.abs(result.rows[0].canonUnitarioMensual.toNumber() - expectedUnit) < 1e-9);
          assert.ok(Math.abs(result.totalMonthlyBeforeTax.toNumber() - expectedUnit * quantity) < 1e-7);
        }
      }
    }
  }
});

test("Mantiene referencias repetidas en orden y suma valores sin redondear", () => {
  const result = calculateQuote({
    termMonths: 36,
    packageType: "Premium",
    margin: 0.15,
    rows: [
      { assetType: "Laptop", reference: "A", quantity: 2, unitCost: 1000.123 },
      { assetType: "Laptop", reference: "B", quantity: 31, unitCost: 1200.987 },
    ],
  }, DEFAULT_PRICING_CONFIG);
  assert.deepEqual(result.rows.map((row) => row.reference), ["A", "B"]);
  assert.ok(result.totalMonthlyBeforeTax.equals(
    result.rows[0].canonMensualTotal.plus(result.rows[1].canonMensualTotal),
  ));
  assert.notEqual(result.rows[0].canonUnitarioMensual.toString(), result.rows[0].canonUnitarioMensual.toFixed(2));
});

test("El paquete conserva residual cero y la tasa cero utiliza el límite de PMT", () => {
  const config = clonePricingConfig(DEFAULT_PRICING_CONFIG);
  config.monthlyPlacementRate = 0;
  validatePricingConfig(config);
  const result = calculateQuote({
    termMonths: 12,
    packageType: "Básico",
    margin: 0.12,
    rows: [{ assetType: "Laptop", reference: "A", quantity: 1, unitCost: 1000 }],
  }, config);
  assert.ok(Math.abs(result.rows[0].canonPaquetePorUnidad.toNumber() - 35 / 0.95 / 12) < 1e-12);
  assert.ok(Math.abs(calculateInstallment(1000, 0.3, 0, 12).toNumber() - 700 / 12) < 1e-12);
});

test("Ignora el margen de entrada y rechaza cantidad, costo y parámetros incompletos", () => {
  const input = {
    termMonths: 36 as const,
    packageType: "Básico" as const,
    margin: 0.15,
    rows: [{ assetType: "Laptop" as const, reference: "A", quantity: 1, unitCost: 1000 }],
  };
  assert.deepEqual(calculateQuote({ ...input, margin: 0.13 }, DEFAULT_PRICING_CONFIG),
    calculateQuote(input, DEFAULT_PRICING_CONFIG));
  assert.throws(() => calculateQuote({ ...input, rows: [{ ...input.rows[0], quantity: 0 }] }, DEFAULT_PRICING_CONFIG));
  assert.throws(() => calculateQuote({ ...input, rows: [{ ...input.rows[0], unitCost: 0 }] }, DEFAULT_PRICING_CONFIG));
  const config = clonePricingConfig(DEFAULT_PRICING_CONFIG);
  config.spareBases.pop();
  assert.throws(() => validatePricingConfig(config));
});

// Absolute tolerance, not toBeCloseTo(2), which would only allow ±0.005.
const TOLERANCE_USD = 0.01;
function expectWithinTolerance(actual: number, expected: number) {
  expect(
    Math.abs(actual - expected),
    `Esperado ${expected} ± ${TOLERANCE_USD}; recibido ${actual}`,
  ).toBeLessThanOrEqual(TOLERANCE_USD);
}

const commonRows: QuoteLineInput[] = [
  { assetType: "Laptop", reference: "Referencia 1", quantity: 31, unitCost: 1200 },
  { assetType: "Desktop", reference: "Referencia 2", quantity: 1, unitCost: 1300 },
  { assetType: "AIO", reference: "Referencia 3", quantity: 1, unitCost: 1400 },
  { assetType: "Equipo Apple", reference: "Referencia 4", quantity: 1, unitCost: 1500 },
];

const scenarios = [
  {
    name: "Caso A: 36 meses",
    termMonths: 36 as TermMonths,
    margin: 0.05,
    packageCanon: 1.4454,
    unitCanons: [48.67, 52.29, 56.20, 58.44],
    totalCanons: [1508.78, 52.29, 56.20, 58.44],
    total: 1675.71,
  },
  {
    name: "Caso B: 12 meses",
    termMonths: 12 as TermMonths,
    margin: 0.05,
    packageCanon: 3.4838,
    unitCanons: [97.28, 104.47, 112.24, 113.75],
    totalCanons: [3015.64, 104.47, 112.24, 113.75],
    total: 3346.09,
  },
];

describe.each(scenarios)("$name · tolerancia absoluta ±0.01 USD", scenario => {
  const config = clonePricingConfig(DEFAULT_PRICING_CONFIG);
  const quote = calculateQuote({
    termMonths: scenario.termMonths,
    margin: scenario.margin,
    packageType: "Básico",
    rows: commonRows,
  }, config);

  it("financia el paquete Básico de 35 USD con residual cero y tasa 0.02", () => {
    expect(config.monthlyPlacementRate).toBe(0.02);
    expect(config.servicePackages.find(p => p.packageType === "Básico")?.unitCost).toBe(35);
    quote.rows.forEach(row => expectWithinTolerance(
      row.canonPaquetePorUnidad.toNumber(), scenario.packageCanon,
    ));
    const compound = (1 + 0.02) ** scenario.termMonths;
    const zeroResidualPackageCanon = (35 / (1 - scenario.margin)) * compound * 0.02 / (compound - 1);
    expectWithinTolerance(quote.rows[0].canonPaquetePorUnidad.toNumber(), zeroResidualPackageCanon);
  });

  it.each(commonRows.map((row, index) => ({ ...row, index })))(
    "$assetType · $reference: canon unitario y total",
    ({ index, assetType, reference, quantity }) => {
      const actual = quote.rows[index];
      expect(actual).toMatchObject({ assetType, reference, quantity });
      expectWithinTolerance(actual.canonUnitarioMensual.toNumber(), scenario.unitCanons[index]);
      expectWithinTolerance(actual.canonMensualTotal.toNumber(), scenario.totalCanons[index]);
    },
  );

  it("devuelve el total esperado sin redondear previamente los cánones", () => {
    expect(quote.rows).toHaveLength(4);
    expectWithinTolerance(quote.totalMonthlyBeforeTax.toNumber(), scenario.total);
    const sum = quote.rows.reduce((total, row) => total.plus(row.canonMensualTotal),
      quote.totalMonthlyBeforeTax.mul(0));
    expect(quote.totalMonthlyBeforeTax.equals(sum)).toBe(true);
  });

  it("el objetivo del periodo no determina el precio", () => {
    expect(calculateQuote({
      termMonths: scenario.termMonths,
      margin: config.margins.find(row => row.termMonths === scenario.termMonths)!.minimum - 0.0001,
      packageType: "Básico",
      rows: commonRows,
    }, config).totalMonthlyBeforeTax.toString()).toBe(quote.totalMonthlyBeforeTax.toString());
  });
});

/**
 * The total unit cost is internal, not an exported result field.
 * Recover it from the unrounded product canon using an independent inverse PMT,
 * rather than changing the production API or repeating the spare implementation.
 */
function unitCostFromProductCanon(row: CalculatedQuoteLine, term: TermMonths, margin: number, rate: number) {
  const compound = (1 + rate) ** term;
  const installmentFactor = (compound - row.residual) * rate / (compound - 1);
  return row.canonProducto.toNumber() / installmentFactor / row.quantity * (1 - margin);
}

it("Caso A: el costoUnitarioTotal de la Laptop con 31 unidades es 1234.29 USD", () => {
  const quote = calculateQuote({
    termMonths: 36, margin: 0.15, packageType: "Básico", rows: commonRows,
  }, DEFAULT_PRICING_CONFIG);
  expectWithinTolerance(unitCostFromProductCanon(quote.rows[0], 36, 0.05, 0.02), 1234.29);
});

describe("Spare: ramas por cantidad y límite exacto de la base", () => {
  it.each([
    { quantity: 1, expectedCost: 1234.285714, branch: "cantidad menor que la base" },
    { quantity: 35, expectedCost: 1234.285714, branch: "cantidad igual a la base" },
    { quantity: 36, expectedCost: 1235.265306, branch: "cantidad mayor que la base" },
    { quantity: 70, expectedCost: 1268.571429, branch: "cantidad igual al doble de la base" },
  ])("$branch: $quantity unidades", ({ quantity, expectedCost }) => {
    // Zero interest and residual isolate spare from the financial PMT factor.
    const config = clonePricingConfig(DEFAULT_PRICING_CONFIG);
    config.monthlyPlacementRate = 0;
    config.residuals.find(r => r.termMonths === 36)!.assets
      .find(a => a.assetType === "Laptop")!.fraction = 0;
    expect(config.spareBases.find(b => b.assetType === "Laptop")?.units).toBe(35);
    const quote = calculateQuote({
      termMonths: 36, margin: 0.15, packageType: "Básico",
      rows: [{ assetType: "Laptop", reference: "Spare", quantity, unitCost: 1200 }],
    }, config);
    const actualCost = quote.rows[0].canonProducto.mul(36).mul("0.95").div(quantity);
    expectWithinTolerance(actualCost.toNumber(), expectedCost);
  });
});

it("Caso C: 50 Laptop y 65 Desktop superan sus bases spare", () => {
  const quote = calculateQuote({
    termMonths: 36, margin: 0.15, packageType: "Básico",
    rows: [
      { assetType: "Laptop", reference: "Spare L", quantity: 50, unitCost: 1200 },
      { assetType: "Desktop", reference: "Spare D", quantity: 65, unitCost: 1100 },
    ],
  }, DEFAULT_PRICING_CONFIG);
  expectWithinTolerance(unitCostFromProductCanon(quote.rows[0], 36, 0.05, 0.02), 1248.98);
  expectWithinTolerance(unitCostFromProductCanon(quote.rows[1], 36, 0.05, 0.02), 1135.31);
  expectWithinTolerance(quote.rows[0].canonUnitarioMensual.toNumber(), 49.23);
  expectWithinTolerance(quote.rows[0].canonMensualTotal.toNumber(), 2461.63);
  expectWithinTolerance(quote.rows[1].canonUnitarioMensual.toNumber(), 44.88);
  expectWithinTolerance(quote.rows[1].canonMensualTotal.toNumber(), 2917.42);
  expectWithinTolerance(quote.totalMonthlyBeforeTax.toNumber(), 5379.05);
});

it("Las tasas residuales por activo y plazo coinciden con la tabla acordada", () => {
  const values: Record<number, number[]> = {
    12: [.30, .30, .30, .35, 0, 0, 0, 0],
    24: [.20, .20, .20, .25, 0, 0, 0, 0],
    36: [.15, .15, .15, .20, 0, 0, 0, 0],
    48: [.08, .08, .08, .15, 0, 0, 0, 0],
    60: [0, 0, 0, 0, 0, 0, 0, 0],
  };
  for (const term of TERM_MONTHS) {
    const config = DEFAULT_PRICING_CONFIG.residuals.find(row => row.termMonths === term)!;
    expect(config.assets.map(row => row.assetType)).toEqual(ASSET_TYPES);
    expect(config.assets.map(row => row.fraction)).toEqual([...values[term], 0, 0, 0]);
    const quote = calculateQuote({
      termMonths: term, margin: DEFAULT_PRICING_CONFIG.margins.find(row => row.termMonths === term)!.target,
      packageType: "Básico",
      rows: ASSET_TYPES.map(assetType => ({ assetType, reference: assetType, quantity: 1, unitCost: 1200 })),
    }, DEFAULT_PRICING_CONFIG);
    expect(quote.rows.map(row => row.residual)).toEqual([...values[term], 0, 0, 0]);
  }
});

it("devuelve 8 filas en orden, incluidas dos Laptop con referencias distintas, sin agruparlas", () => {
  const rows: QuoteLineInput[] = [
    ...commonRows,
    { assetType: "Laptop", reference: "Referencia 5", quantity: 2, unitCost: 1100 },
    { assetType: "Movilidad", reference: "Referencia 6", quantity: 1, unitCost: 800 },
    { assetType: "Infraestructura", reference: "Referencia 7", quantity: 1, unitCost: 2000 },
    { assetType: "Accesorios", reference: "Referencia 8", quantity: 3, unitCost: 100 },
  ];
  const quote = calculateQuote({
    termMonths: 36, margin: 0.15, packageType: "Básico", rows,
  }, DEFAULT_PRICING_CONFIG);
  expect(quote.rows).toHaveLength(8);
  expect(quote.rows.map(({ assetType, reference, quantity }) => ({ assetType, reference, quantity })))
    .toEqual(rows.map(({ assetType, reference, quantity }) => ({ assetType, reference, quantity })));
  expect(quote.rows.filter(row => row.assetType === "Laptop").map(row => row.reference))
    .toEqual(["Referencia 1", "Referencia 5"]);
  quote.rows.forEach((row, index) => {
    const individual = calculateQuote({
      termMonths: 36, margin: 0.15, packageType: "Básico", rows: [rows[index]],
    }, DEFAULT_PRICING_CONFIG);
    expectWithinTolerance(row.canonMensualTotal.toNumber(), individual.totalMonthlyBeforeTax.toNumber());
  });
});
