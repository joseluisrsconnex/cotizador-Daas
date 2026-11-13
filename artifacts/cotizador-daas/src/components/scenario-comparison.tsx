import { useState } from "react";
import type { CalculatedQuoteLine, ExactAmount, QuoteLineInput, TermMonths } from "@workspace/pricing";
import { formatUsd } from "@/lib/format";
import "./quote-scenarios.css";

export interface QuoteScenarioView { termMonths: TermMonths; calculatedRows: Array<CalculatedQuoteLine | undefined>; total: ExactAmount | undefined }

export function ScenarioComparisonTable({ rows, scenarios, invalidRows }: { rows: QuoteLineInput[]; scenarios: QuoteScenarioView[]; invalidRows: boolean[] }) {
  const primary = scenarios[0]?.termMonths;
  return <div className="config-table-wrap">
    <table className="config-table output-table comparison-table" data-testid="table-scenario-comparison">
      <caption className="sr-only">Comparativa de canon mensual por periodo</caption>
      <thead>
        <tr>
          <th rowSpan={2}>Tipo de producto</th><th rowSpan={2}>Referencia</th><th rowSpan={2}>Cantidad</th>
          {scenarios.map(s => <th key={s.termMonths} colSpan={2} scope="colgroup" className="term-start">{s.termMonths} meses{scenarios.length > 1 && s.termMonths === primary ? " · principal" : ""}</th>)}
        </tr>
        <tr>{scenarios.map(s => [
          <th key={`u${s.termMonths}`} className="term-start">Canon unitario mensual USD antes de IVA</th>,
          <th key={`t${s.termMonths}`}>Canon mensual total USD antes de IVA</th>,
        ])}</tr>
      </thead>
      <tbody>
        {rows.map((row, index) => <tr key={index} className={invalidRows[index] ? "invalid-row" : ""}>
          <td>{row.assetType}</td><td>{row.reference.trim() || "Sin referencia"}</td><td>{row.quantity}</td>
          {scenarios.map(s => [
            <td key={`u${s.termMonths}`} className="mono term-start">{formatUsd(s.calculatedRows[index]?.canonUnitarioMensual)}</td>,
            <td key={`t${s.termMonths}`} className="mono">{formatUsd(s.calculatedRows[index]?.canonMensualTotal)}</td>,
          ])}
        </tr>)}
        {rows.length === 0 && <tr><td colSpan={3 + scenarios.length * 2}>Añada al menos una referencia para cotizar.</td></tr>}
      </tbody>
      <tfoot>
        <tr><td colSpan={3}>Total mensual antes de IVA por periodo</td>
          {scenarios.map(s => <td key={s.termMonths} colSpan={2} className="mono term-start" data-testid={`text-scenario-total-${s.termMonths}`}>{formatUsd(s.total)}</td>)}
        </tr>
      </tfoot>
    </table>
  </div>;
}

export function ScenarioTabs({ rows, scenarios, invalidRows }: { rows: QuoteLineInput[]; scenarios: QuoteScenarioView[]; invalidRows: boolean[] }) {
  const [active, setActive] = useState<TermMonths | null>(null);
  if (scenarios.length === 0) return null;
  const current = scenarios.find(s => s.termMonths === active) ?? scenarios[0];
  return <section className="scenario-tabs" aria-label="Detalle por escenario">
    <div className="scenario-tablist" role="tablist">
      {scenarios.map(s => <button key={s.termMonths} type="button" role="tab" id={`tab-scenario-${s.termMonths}`} aria-controls="panel-scenario"
        aria-selected={s.termMonths === current.termMonths} data-testid={`tab-scenario-${s.termMonths}`} className="scenario-tab" onClick={() => setActive(s.termMonths)}>
        Escenario {s.termMonths} meses</button>)}
    </div>
    <div className="scenario-panel" role="tabpanel" id="panel-scenario" aria-labelledby={`tab-scenario-${current.termMonths}`} key={current.termMonths}>
      <div className="config-table-wrap">
        <table className="config-table output-table" data-testid={`table-scenario-${current.termMonths}`}>
          <thead><tr><th>Tipo de producto</th><th>Referencia</th><th>Cantidad</th><th>Canon unitario mensual USD antes de IVA</th><th>Canon mensual total USD antes de IVA</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={index} className={invalidRows[index] ? "invalid-row" : ""}>
            <td>{row.assetType}</td><td>{row.reference.trim() || "Sin referencia"}</td><td>{row.quantity}</td>
            <td className="mono">{formatUsd(current.calculatedRows[index]?.canonUnitarioMensual)}</td>
            <td className="mono">{formatUsd(current.calculatedRows[index]?.canonMensualTotal)}</td>
          </tr>)}</tbody>
          <tfoot><tr><td colSpan={4}>Total mensual antes de IVA · {current.termMonths} meses</td><td className="mono">{formatUsd(current.total)}</td></tr></tfoot>
        </table>
      </div>
    </div>
  </section>;
}
