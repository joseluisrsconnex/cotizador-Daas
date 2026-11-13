import type { PricingConfig } from "@workspace/api-client-react";
import { percentToFraction } from "@workspace/pricing/normalization";

const pnlFields = [
  ["ica", "ICA sobre ingresos"], ["maintenance", "Mantenimiento sobre costo total"],
  ["insurance", "Seguros sobre costo total"], ["badDebt", "Provisión de cartera sobre ingresos menos costo"],
  ["incomeTax", "Impuesto de renta"],
] as const;

export default function AdminBusinessParameters({ config, onChange }: {
  config: PricingConfig;
  onChange: (config: PricingConfig) => void;
}) {
  const input = (label: string, key: string, value: number, maximum: number, change: (n: number) => void) =>
    <label className="field" key={key}><span>{label}</span><div className="input-suffix wide-input">
      <input aria-label={label} data-testid={`input-business-${key}`} type="number" min="0" max={maximum}
        step="any" value={Number.isFinite(value) ? Number((value * 100).toFixed(6)) : ""}
        onChange={e => change(e.target.value.trim() === "" ? NaN : percentToFraction(e.target.value))} /><i>%</i>
    </div></label>;
  return <section className="panel">
    <div className="section-heading"><div><h2>Precio y P&G</h2>
      <p>El margen comercial fija el precio en todos los plazos. El P&G determina la rentabilidad neta del negocio.</p></div></div>
    <div className="residual-grid">
      {input("Margen comercial", "commercialMargin", config.commercialMargin, 50, commercialMargin => onChange({ ...config, commercialMargin }))}
      {pnlFields.map(([key, label]) => input(label, key, config.profitAndLoss[key], 100,
        value => onChange({ ...config, profitAndLoss: { ...config.profitAndLoss, [key]: value } })))}
    </div>
  </section>;
}
