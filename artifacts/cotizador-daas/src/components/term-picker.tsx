import type { TermMonths } from "@workspace/api-client-react";
import { ALL_TERMS, shortestTerm, sortTerms } from "@/lib/quote-validation";
import "./quote-scenarios.css";

export default function TermPicker({ terms, onChange, error }: { terms: TermMonths[]; onChange: (next: TermMonths[]) => void; error?: string | null }) {
  const primary = shortestTerm(terms);
  return <fieldset className="term-picker" aria-describedby="terms-error" aria-invalid={Boolean(error)}>
    <legend>Periodos de la operación <small>Mínimo uno</small></legend>
    <div className="term-options">
    {ALL_TERMS.map(term => {
      const checked = terms.includes(term);
      return <label key={term} className={`term-chip ${checked ? "is-checked" : ""}`}>
        <input type="checkbox" data-testid={`checkbox-term-${term}`} checked={checked}
          onChange={e => onChange(sortTerms(e.target.checked ? [...terms, term] : terms.filter(t => t !== term)))} />
        {term} meses{checked && term === primary && <small>Principal</small>}
      </label>;
    })}
    </div>
    <div id="terms-error" aria-live="polite">{error && <small className="field-error">{error}</small>}</div>
  </fieldset>;
}
