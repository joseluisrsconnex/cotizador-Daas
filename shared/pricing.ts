import Decimal from "decimal.js";
import { DEFAULT_INDIVIDUAL_SERVICES } from "./service-catalog";

export const NEW_ASSET_TYPES = ["HW Seguridad", "Equipos POS", "Licenciamiento"] as const;

export const ASSET_TYPES = [
  "Laptop",
  "Desktop",
  "AIO",
  "Equipo Apple",
  "Movilidad",
  "Infraestructura",
  "Impresión",
  "Accesorios",
  ...NEW_ASSET_TYPES,
] as const;

export const TERM_MONTHS = [12, 24, 36, 48, 60] as const;
export const SERVICE_PACKAGE_TYPES = ["Básico", "Intermedio", "Premium"] as const;

export type AssetType = (typeof ASSET_TYPES)[number];
export type TermMonths = (typeof TERM_MONTHS)[number];
export type ServicePackageType = (typeof SERVICE_PACKAGE_TYPES)[number];
export const SERVICE_UNITS = ["Por equipo", "Por perfil", "Por evento", "Por año", "Por equipo saliente", "Por equipo por evento"] as const;
export interface IndividualService {
  id: string;
  name: string;
  unitCost: number;
  unit: (typeof SERVICE_UNITS)[number];
  mandatory: boolean;
  active: boolean;
}

export type ServiceMode = "Paquete" | "Servicios individuales";
export interface ServiceEvents { termMonths: TermMonths; quantity: number }
export interface ServiceSelection { id: string; quantity?: number; events?: ServiceEvents[] }
export interface CustomQuoteService {
  id: string; name: string; unitCost: number; unit: IndividualService["unit"]; quantity?: number; events?: ServiceEvents[];
}
export interface QuoteServiceInput {
  serviceMode?: ServiceMode;
  selectedServices?: ServiceSelection[];
  customServices?: CustomQuoteService[];
}
export interface QuoteServiceSnapshot {
  serviceMode: ServiceMode;
  selectedServices: ServiceSelection[];
  customServices: CustomQuoteService[];
  includedServices: CustomQuoteService[];
}

export interface PricingConfig {
  commercialMargin: number;
  profitAndLoss: { ica: number; maintenance: number; insurance: number; badDebt: number; incomeTax: number };
  monthlyPlacementRate: number;
  monthlyFundingRate: number;
  spareBases: Array<{ assetType: AssetType; units: number }>;
  residuals: Array<{
    termMonths: TermMonths;
    assets: Array<{ assetType: AssetType; fraction: number }>;
  }>;
  margins: Array<{ termMonths: TermMonths; target: number; minimum: number; profitable: number }>;
  individualServices: IndividualService[];
  servicePackages: Array<{
    packageType: ServicePackageType;
    unitCost: number;
    detail: string;
  }>;
}

export interface QuoteLineInput {
  assetType: AssetType;
  reference: string;
  quantity: number;
  unitCost: number;
  warrantyExtensions?: Array<{ termMonths: TermMonths; unitCost: number }>;
}

export interface QuoteCalculationInput {
  termMonths: TermMonths;
  packageType: ServicePackageType | null;
  serviceUnitCost?: Decimal.Value;
  margin?: number;
  rows: QuoteLineInput[];
}

const PreciseDecimal = Decimal.clone({
  precision: 48,
  rounding: Decimal.ROUND_HALF_UP,
});

export type ExactAmount = Decimal;

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  commercialMargin: 0.05,
  profitAndLoss: { ica: 0.01, maintenance: 0.02, insurance: 0.02, badDebt: 0.02, incomeTax: 0.35 },
  monthlyPlacementRate: 0.02,
  monthlyFundingRate: 0,
  spareBases: [
    { assetType: "Laptop", units: 35 },
    { assetType: "Desktop", units: 45 },
    { assetType: "AIO", units: 45 },
    { assetType: "Equipo Apple", units: 50 },
    { assetType: "Movilidad", units: 25 },
    { assetType: "Infraestructura", units: 100 },
    { assetType: "Impresión", units: 25 },
    { assetType: "Accesorios", units: 50 },
    { assetType: "HW Seguridad", units: 10 },
    { assetType: "Equipos POS", units: 10 },
    { assetType: "Licenciamiento", units: 20 },
  ],
  residuals: [
    {
      termMonths: 12,
      assets: [
        { assetType: "Laptop", fraction: 0.3 },
        { assetType: "Desktop", fraction: 0.3 },
        { assetType: "AIO", fraction: 0.3 },
        { assetType: "Equipo Apple", fraction: 0.35 },
        { assetType: "Movilidad", fraction: 0 },
        { assetType: "Infraestructura", fraction: 0 },
        { assetType: "Impresión", fraction: 0 },
        { assetType: "Accesorios", fraction: 0 },
        ...NEW_ASSET_TYPES.map(assetType => ({ assetType, fraction: 0 })),
      ],
    },
    {
      termMonths: 24,
      assets: [
        { assetType: "Laptop", fraction: 0.2 },
        { assetType: "Desktop", fraction: 0.2 },
        { assetType: "AIO", fraction: 0.2 },
        { assetType: "Equipo Apple", fraction: 0.25 },
        { assetType: "Movilidad", fraction: 0 },
        { assetType: "Infraestructura", fraction: 0 },
        { assetType: "Impresión", fraction: 0 },
        { assetType: "Accesorios", fraction: 0 },
        ...NEW_ASSET_TYPES.map(assetType => ({ assetType, fraction: 0 })),
      ],
    },
    {
      termMonths: 36,
      assets: [
        { assetType: "Laptop", fraction: 0.15 },
        { assetType: "Desktop", fraction: 0.15 },
        { assetType: "AIO", fraction: 0.15 },
        { assetType: "Equipo Apple", fraction: 0.2 },
        { assetType: "Movilidad", fraction: 0 },
        { assetType: "Infraestructura", fraction: 0 },
        { assetType: "Impresión", fraction: 0 },
        { assetType: "Accesorios", fraction: 0 },
        ...NEW_ASSET_TYPES.map(assetType => ({ assetType, fraction: 0 })),
      ],
    },
    {
      termMonths: 48,
      assets: [
        { assetType: "Laptop", fraction: 0.08 },
        { assetType: "Desktop", fraction: 0.08 },
        { assetType: "AIO", fraction: 0.08 },
        { assetType: "Equipo Apple", fraction: 0.15 },
        { assetType: "Movilidad", fraction: 0 },
        { assetType: "Infraestructura", fraction: 0 },
        { assetType: "Impresión", fraction: 0 },
        { assetType: "Accesorios", fraction: 0 },
        ...NEW_ASSET_TYPES.map(assetType => ({ assetType, fraction: 0 })),
      ],
    },
    {
      termMonths: 60,
      assets: ASSET_TYPES.map((assetType) => ({ assetType, fraction: 0 })),
    },
  ],
  margins: [
    { termMonths: 12, target: 0.12, minimum: 0.10, profitable: 0.14 },
    { termMonths: 24, target: 0.14, minimum: 0.12, profitable: 0.16 },
    { termMonths: 36, target: 0.16, minimum: 0.14, profitable: 0.18 },
    { termMonths: 48, target: 0.20, minimum: 0.18, profitable: 0.22 },
    { termMonths: 60, target: 0.22, minimum: 0.20, profitable: 0.24 },
  ],
  individualServices: DEFAULT_INDIVIDUAL_SERVICES.map(item => ({ ...item })),
  servicePackages: [
    {
      packageType: "Básico",
      unitCost: 40,
      detail:
        "Logística de entrega de equipos, etiquetado, logística inversa, mesa de ayuda para garantías y siniestros.",
    },
    {
      packageType: "Intermedio",
      unitCost: 60,
      detail:
        "Todo lo incluido en Básico, más creación de imagen (hasta 5 imágenes), clonación y acta de entrega firmada.",
    },
    {
      packageType: "Premium",
      unitCost: 80,
      detail:
        "Todo lo incluido en Intermedio, más migración de información.",
    },
  ],
};

export function clonePricingConfig(config: PricingConfig): PricingConfig {
  return {
    commercialMargin: config.commercialMargin,
    profitAndLoss: { ...config.profitAndLoss },
    monthlyPlacementRate: config.monthlyPlacementRate,
    monthlyFundingRate: config.monthlyFundingRate,
    spareBases: config.spareBases.map((item) => ({ ...item })),
    residuals: config.residuals.map((term) => ({
      termMonths: term.termMonths,
      assets: term.assets.map((asset) => ({ ...asset })),
    })),
    margins: config.margins.map((item) => ({ ...item })),
    individualServices: config.individualServices.map(item => ({ ...item })),
    servicePackages: config.servicePackages.map((item) => ({ ...item })),
  };
}

export function validatePricingConfig(config: PricingConfig): void {
  if (!Number.isFinite(config.monthlyFundingRate) || config.monthlyFundingRate < 0 || config.monthlyFundingRate > 0.1)
    throw new Error("La tasa de captación mensual debe estar entre 0 y 10 %.");
  if (!Number.isFinite(config.commercialMargin) || config.commercialMargin < 0 || config.commercialMargin > 0.5)
    throw new Error("El margen comercial debe estar entre 0 y 0,5.");
  if (!config.profitAndLoss || ["ica", "maintenance", "insurance", "badDebt", "incomeTax"].some(key => {
    const value = config.profitAndLoss[key as keyof PricingConfig["profitAndLoss"]];
    return !Number.isFinite(value) || value < 0 || value > 1;
  })) throw new Error("Los parámetros del P&G deben estar entre 0 y 1.");
  if (
    !Number.isFinite(config.monthlyPlacementRate) ||
    config.monthlyPlacementRate < 0 ||
    config.monthlyPlacementRate >= 1
  ) {
    throw new Error("La tasa mensual debe ser mayor o igual a 0 y menor que 1.");
  }

  assertExactValues(
    config.spareBases.map((item) => item.assetType),
    ASSET_TYPES,
    "Las bases spare deben incluir cada tipo de activo exactamente una vez.",
  );
  for (const item of config.spareBases) {
    if (!Number.isInteger(item.units) || item.units <= 0) {
      throw new Error("Cada base spare debe ser un entero mayor que 0.");
    }
  }

  assertExactValues(
    config.residuals.map((item) => item.termMonths),
    TERM_MONTHS,
    "Debe existir una tabla de residuales para cada periodo.",
  );
  for (const term of config.residuals) {
    assertExactValues(
      term.assets.map((item) => item.assetType),
      ASSET_TYPES,
      `El residual de ${term.termMonths} meses debe incluir cada tipo de activo una vez.`,
    );
    for (const asset of term.assets) {
      if (!Number.isFinite(asset.fraction) || asset.fraction < 0 || asset.fraction > 1) {
        throw new Error("Los residuales deben estar entre 0 y 1.");
      }
    }
  }

  assertExactValues(
    config.margins.map((item) => item.termMonths),
    TERM_MONTHS,
    "Debe existir una fila de márgenes para cada periodo.",
  );
  for (const item of config.margins) {
    if ([item.target, item.minimum, item.profitable].some(value => !Number.isFinite(value) || value < 0 || value >= 1))
      throw new Error("Los márgenes deben ser mayores o iguales a 0 y menores que 1.");
    if (item.target < item.minimum) throw new Error("El Objetivo no puede ser menor que el Mínimo.");
    if (item.target > item.profitable) throw new Error("El Objetivo no puede ser mayor que Rentable.");
  }
  if (new Set(config.individualServices.map(item => item.id)).size !== config.individualServices.length)
    throw new Error("Los identificadores de servicios no pueden repetirse.");
  for (const item of config.individualServices) {
    if (!item.id.trim() || !item.name.trim() || !Number.isFinite(item.unitCost) || item.unitCost < 0 ||
      !SERVICE_UNITS.includes(item.unit) || typeof item.mandatory !== "boolean" || typeof item.active !== "boolean")
      throw new Error("Cada servicio necesita nombre, costo USD válido, unidad permitida y estado.");
  }

  assertExactValues(
    config.servicePackages.map((item) => item.packageType),
    SERVICE_PACKAGE_TYPES,
    "Deben existir los tres paquetes de servicio exactamente una vez.",
  );
  for (const item of config.servicePackages) {
    if (
      !Number.isFinite(item.unitCost) ||
      item.unitCost < 0 ||
      item.detail.trim().length === 0
    ) {
      throw new Error("Cada paquete necesita un costo válido y un detalle.");
    }
  }
}

function assertExactValues(
  actual: readonly unknown[],
  expected: readonly unknown[],
  message: string,
): void {
  if (
    actual.length !== expected.length ||
    new Set(actual).size !== actual.length ||
    expected.some((value) => !actual.includes(value))
  ) {
    throw new Error(message);
  }
}

export function calculateInstallment(
  presentValue: Decimal.Value,
  residual: Decimal.Value,
  monthlyRate: Decimal.Value,
  termMonths: TermMonths,
): ExactAmount {
  const pv = new PreciseDecimal(presentValue);
  const res = new PreciseDecimal(residual);
  const rate = new PreciseDecimal(monthlyRate);

  if (pv.isNegative() || res.isNegative() || res.greaterThan(1) || rate.isNegative()) {
    throw new Error("Los valores financieros no pueden ser negativos.");
  }

  if (rate.isZero()) {
    return pv.mul(new PreciseDecimal(1).minus(res)).div(termMonths);
  }

  const compound = new PreciseDecimal(1).plus(rate).pow(termMonths);
  return pv
    .mul(compound.minus(res))
    .mul(rate)
    .div(compound.minus(1));
}

export interface CalculatedQuoteLine {
  assetType: AssetType;
  reference: string;
  quantity: number;
  canonUnitarioMensual: ExactAmount;
  canonMensualTotal: ExactAmount;
  canonProducto: ExactAmount;
  canonPaquetePorUnidad: ExactAmount;
  residual: number;
}

export interface CalculatedQuote {
  rows: CalculatedQuoteLine[];
  totalMonthlyBeforeTax: ExactAmount;
  totalCost: ExactAmount;
  residualRecovery: ExactAmount;
}

export function calculateQuote(
  input: QuoteCalculationInput,
  config: PricingConfig,
): CalculatedQuote {
  validatePricingConfig(config);

  const spareBases = new Map(
    config.spareBases.map((item) => [item.assetType, item.units]),
  );
  const residuals = new Map(
    config.residuals
      .find((item) => item.termMonths === input.termMonths)!
      .assets.map((item) => [item.assetType, item.fraction]),
  );
  const service = config.servicePackages.find(
    (item) => item.packageType === input.packageType,
  );
  if (!service && input.serviceUnitCost === undefined) throw new Error("El paquete de servicio seleccionado no existe.");

  const rate = new PreciseDecimal(config.monthlyPlacementRate);
  const margin = new PreciseDecimal(config.commercialMargin);
  const sellingDenominator = new PreciseDecimal(1).minus(margin);
  const packageInstallment = calculateInstallment(
    new PreciseDecimal(input.serviceUnitCost ?? service!.unitCost).div(sellingDenominator),
    0,
    rate,
    input.termMonths,
  );

  let totalCost = new PreciseDecimal(0);
  let residualRecovery = new PreciseDecimal(0);
  const rows = input.rows.map((row) => {
    if (!Number.isInteger(row.quantity) || row.quantity <= 0) {
      throw new Error("La cantidad debe ser un entero mayor que 0.");
    }
    if (!Number.isFinite(row.unitCost) || row.unitCost <= 0) {
      throw new Error("El costo unitario debe ser mayor que 0.");
    }
    const base = spareBases.get(row.assetType);
    const residual = row.assetType === "Licenciamiento" ? 0 : residuals.get(row.assetType);
    if (base === undefined || residual === undefined) {
      throw new Error("Faltan parámetros para el tipo de activo seleccionado.");
    }

    const unitCost = new PreciseDecimal(row.unitCost);
    const quantity = new PreciseDecimal(row.quantity);
    const spareCost = unitCost.div(base);
    const unitCostWithSpare = unitCost.plus(
      row.quantity <= base ? spareCost : spareCost.mul(quantity).div(base),
    );
    const saleValue = unitCostWithSpare
      .div(sellingDenominator)
      .mul(quantity);
    totalCost = totalCost.plus(unitCostWithSpare.mul(quantity));
    if (row.assetType !== "Licenciamiento")
      totalCost = totalCost.plus(new PreciseDecimal(input.serviceUnitCost ?? service!.unitCost).mul(quantity));
    residualRecovery = residualRecovery.plus(saleValue.mul(residual));
    const productInstallment = calculateInstallment(
      saleValue,
      residual,
      rate,
      input.termMonths,
    );
    const rowServices = row.assetType === "Licenciamiento" ? new PreciseDecimal(0) : packageInstallment;
    const unitMonthly = productInstallment.div(quantity).plus(rowServices);

    return {
      assetType: row.assetType,
      reference: row.reference,
      quantity: row.quantity,
      canonUnitarioMensual: unitMonthly,
      canonMensualTotal: unitMonthly.mul(quantity),
      canonProducto: productInstallment,
      canonPaquetePorUnidad: rowServices,
      residual,
    };
  });

  return {
    rows,
    totalCost,
    residualRecovery,
    totalMonthlyBeforeTax: rows.reduce(
      (sum, row) => sum.plus(row.canonMensualTotal),
      new PreciseDecimal(0),
    ),
  };
}
