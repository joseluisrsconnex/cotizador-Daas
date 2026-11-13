import type { QuoteScenario } from "@workspace/api-client-react";
import Decimal from "decimal.js";
import { formatUsd } from "@/lib/format";

export function marginState(scenarios: QuoteScenario[]) {
  const states = scenarios.flatMap(s => s.profitability ? [s.profitability.status] : []);
  if (!states.length) return "Sin evaluación histórica";
  if (states.includes("Bajo mínimo")) return "Bajo mínimo";
  if (states.includes("Bajo objetivo")) return "Margen bajo objetivo";
  return states.every(s => s === "Rentable") ? "Rentable" : "En objetivo";
}

export default function VersionProfitability({ scenarios }: { scenarios: QuoteScenario[] }) {
  return <section className="nt-section" aria-labelledby="profitability-title" data-testid="version-profitability">
    <h2 id="profitability-title">Rentabilidad de esta versión</h2>
    <p>{marginState(scenarios)}. Información interna, excluida de PDF, Excel y Word.</p>
    <div className="nt-table-wrap"><table className="nt-table">
      <thead><tr><th>PLAZO</th><th>INGRESOS</th><th>COSTO TOTAL</th><th>TASA DE CAPTACIÓN MENSUAL</th><th>INTERESES DE FONDEO</th><th>UTILIDAD NETA</th><th>MARGEN NETO</th><th>ESTADO</th></tr></thead>
      <tbody>{scenarios.map(s => <tr key={s.termMonths}>
        <td>{s.termMonths} meses</td>
        {s.profitability ? <>
          {[s.profitability.revenue, s.profitability.totalCost].map((n, i) => <td key={i} className="num">{formatUsd(new Decimal(n))}</td>)}
          <td className="num">{s.profitability.monthlyFundingRate === undefined ? "Sin registro histórico" : `${(s.profitability.monthlyFundingRate * 100).toLocaleString("es-CO", { maximumFractionDigits: 4 })} %`}</td>
          <td className="num">{s.profitability.fundingInterest === undefined ? "Sin registro histórico" : formatUsd(new Decimal(s.profitability.fundingInterest))}</td>
          <td className="num">{formatUsd(new Decimal(s.profitability.netProfit))}</td>
          <td className="num">{(s.profitability.netMargin * 100).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %</td>
          <td>{s.profitability.status}</td>
        </> : <td colSpan={7}>Sin evaluación histórica. No se recalcula esta versión.</td>}
      </tr>)}</tbody>
    </table></div>
  </section>;
}
