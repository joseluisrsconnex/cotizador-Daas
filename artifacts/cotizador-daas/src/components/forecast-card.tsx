import { formatUsd } from "@/lib/format";
import type { ExactAmount } from "@workspace/pricing";
import Decimal from "decimal.js";
import "./forecast-card.css";

export default function ForecastCard({ amount, term }: { amount?: ExactAmount; term?: number }) {
  const monthly = amount === undefined ? undefined : new Decimal(amount.toFixed(2));
  const forecast = monthly !== undefined && term ? monthly.times(term) : undefined;
  return <section className="forecast-card" data-testid="forecast-card" aria-label="Valor del contrato para reporte de Forecast">
    <h3>Valor del contrato para reporte de Forecast</h3>
    <strong className="mono">{formatUsd(forecast)}</strong>
    <p>{term ? `Canon mensual ${formatUsd(monthly)} × ${term} meses (escenario de menor plazo)` : "Seleccione un periodo"}</p>
  </section>;
}
