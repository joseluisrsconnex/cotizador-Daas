import type { PeriodMargin } from "@workspace/api-client-react";

export type MarginField = "target" | "minimum" | "profitable";
export type MarginInputs = Record<number, Record<MarginField, string>>;

const fields: { key: MarginField; label: string }[] = [
  { key: "target", label: "Objetivo" },
  { key: "minimum", label: "Mínimo" },
  { key: "profitable", label: "Rentable" },
];

export const toPercentText = (fraction: number) => String(Number((fraction * 100).toFixed(6)));

export function marginInputsFrom(margins: PeriodMargin[]): MarginInputs {
  return Object.fromEntries(margins.map(m => [m.termMonths, {
    target: toPercentText(m.target), minimum: toPercentText(m.minimum), profitable: toPercentText(m.profitable),
  }]));
}

export const isInvalidPercent = (value: string | undefined) =>
  value === undefined || value.trim() === "" || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) >= 100;

export function marginErrors(margins: PeriodMargin[], inputs: MarginInputs): string | null {
  for (const m of margins) {
    const row = inputs[m.termMonths];
    if (!row || fields.some(f => isInvalidPercent(row[f.key]))) return `Plazo ${m.termMonths} meses: cada porcentaje debe estar entre 0 % y menos de 100 %.`;
    if (Number(row.target) < Number(row.minimum)) return `Plazo ${m.termMonths} meses: el margen objetivo no puede ser inferior al mínimo.`;
    if (Number(row.target) > Number(row.profitable)) return `Plazo ${m.termMonths} meses: el margen objetivo no puede ser superior a Rentable.`;
  }
  return null;
}

export function AdminMarginsSection({ margins, inputs, onChange }: {
  margins: PeriodMargin[];
  inputs: MarginInputs;
  onChange: (term: number, field: MarginField, value: string) => void;
}) {
  const error = marginErrors(margins, inputs);
  return <section className="panel animate-enter delay-2">
    <div className="section-heading"><div className="section-number">04</div><div><h2>Márgenes por plazo</h2><p>Objetivo, mínimo y rentable para cada periodo. Solo visible para administradores.</p></div></div>
    <p className="admin-reference-note" data-testid="text-margin-reference">Estos umbrales se comparan con el <b>margen neto</b> y no fijan el precio. Debe cumplirse <b>Mínimo ≤ Objetivo ≤ Rentable</b>. Un escenario bajo mínimo impide guardar y exportar.</p>
    <div className="config-table-wrap"><table className="config-table margin-table"><thead><tr><th>PLAZO</th>{fields.map(f => <th key={f.key}>{f.label.toUpperCase()}</th>)}</tr></thead><tbody>
      {margins.map(m => {
        const row = inputs[m.termMonths];
        const belowMin = row && (Number(row.target) < Number(row.minimum) || Number(row.target) > Number(row.profitable));
        return <tr key={m.termMonths} data-testid={`row-margin-${m.termMonths}`}><td>{m.termMonths} meses</td>{fields.map(f => {
          const value = row?.[f.key] ?? "";
          const invalid = isInvalidPercent(value) || belowMin;
          return <td key={f.key}><div className="input-suffix margin-input"><input aria-label={`${f.label} ${m.termMonths} meses`} data-testid={`input-margin-${f.key}-${m.termMonths}`} type="number" min="0" max="99.999999" step="any" value={value} aria-invalid={Boolean(invalid)} onChange={e => onChange(m.termMonths, f.key, e.target.value)} /><i>%</i></div></td>;
        })}</tr>;
      })}
    </tbody></table></div>
    {error && <p className="field-error" role="alert" data-testid="text-margin-error">{error}</p>}
  </section>;
}
