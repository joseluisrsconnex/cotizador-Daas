import type { AssetType, PricingConfig, QuoteLineInput, TermMonths } from "@workspace/pricing";

// Acceptance fixture, intentionally independent of DEFAULT_PRICING_CONFIG,
// the production service catalog and any saved/database configuration.
export function calculationConfig(): PricingConfig {
  const assets: AssetType[] = ["Laptop", "Desktop", "AIO", "Equipo Apple", "Movilidad", "Infraestructura", "Impresión", "Accesorios", "HW Seguridad", "Equipos POS", "Licenciamiento"];
  const residuals: Array<[TermMonths, number, number]> = [[12, .30, .35], [24, .20, .25], [36, .15, .20], [48, .08, .15], [60, 0, 0]];
  return {
    commercialMargin: .05,
    profitAndLoss: { ica: .01, maintenance: .02, insurance: .02, badDebt: .02, incomeTax: .35 },
    monthlyPlacementRate: .02,
    monthlyFundingRate: 0,
    spareBases: assets.map((assetType, index) => ({ assetType, units: [35, 45, 45, 50, 25, 100, 25, 50, 10, 10, 20][index]! })),
    residuals: residuals.map(([termMonths, computer, apple]) => ({
      termMonths, assets: assets.map(assetType => ({ assetType, fraction: assetType === "Equipo Apple" ? apple :
        ["Laptop", "Desktop", "AIO"].includes(assetType) ? computer : 0 })),
    })),
    margins: [
      { termMonths: 12, target: .12, minimum: .10, profitable: .14 },
      { termMonths: 24, target: .14, minimum: .12, profitable: .16 },
      { termMonths: 36, target: .16, minimum: .14, profitable: .18 },
      { termMonths: 48, target: .20, minimum: .18, profitable: .22 },
      { termMonths: 60, target: .22, minimum: .20, profitable: .24 },
    ],
    servicePackages: [
      { packageType: "Básico", unitCost: 40, detail: "Básico de prueba" },
      { packageType: "Intermedio", unitCost: 60, detail: "Intermedio de prueba" },
      { packageType: "Premium", unitCost: 80, detail: "Premium de prueba" },
    ],
    individualServices: [
      { id: "etiquetado", name: "Etiquetado", unitCost: 3, unit: "Por equipo", mandatory: true, active: true },
      { id: "logistica-entrega", name: "Logística de entrega", unitCost: 15, unit: "Por equipo", mandatory: true, active: true },
      { id: "mesa-ayuda", name: "Mesa de ayuda", unitCost: 15, unit: "Por equipo", mandatory: true, active: true },
      { id: "logistica-inversa", name: "Logística inversa", unitCost: 10, unit: "Por equipo", mandatory: true, active: true },
      { id: "clonacion", name: "Clonación", unitCost: 15, unit: "Por equipo", mandatory: false, active: true },
      { id: "creacion-imagen", name: "Creación de imagen", unitCost: 40, unit: "Por perfil", mandatory: false, active: true },
      { id: "logistica-salientes", name: "Logística inversa (proveedor actual)", unitCost: 25, unit: "Por equipo saliente", mandatory: false, active: true },
      { id: "borrado-seguro-salientes", name: "Borrado seguro equipos salientes (proveedor actual)", unitCost: 10, unit: "Por equipo saliente", mandatory: false, active: true },
      { id: "mantenimiento-preventivo", name: "Mantenimiento preventivo", unitCost: 15, unit: "Por equipo por evento", mandatory: false, active: true },
    ],
  };
}

export function commonRows(extensions = true): QuoteLineInput[] {
  return [
    { assetType: "Laptop", reference: "E14", quantity: 50, unitCost: 1200, warrantyExtensions: [{ termMonths: 36, unitCost: 60 }, { termMonths: 60, unitCost: 120 }] },
    { assetType: "Desktop", reference: "neo50", quantity: 40, unitCost: 1100, warrantyExtensions: [{ termMonths: 36, unitCost: 50 }, { termMonths: 60, unitCost: 100 }] },
    { assetType: "HW Seguridad", reference: "FW-1", quantity: 5, unitCost: 800, warrantyExtensions: [{ termMonths: 36, unitCost: 40 }, { termMonths: 60, unitCost: 80 }] },
  ].map(row => extensions ? row : (({ warrantyExtensions: _extensions, ...base }) => base)(row)) as QuoteLineInput[];
}
