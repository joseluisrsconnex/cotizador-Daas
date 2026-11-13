import { Plus, Trash2, Lock } from "lucide-react";
import type { QuoteCatalog, ServicePackageType, TermMonths } from "@workspace/api-client-react";
import { formatUsd as currency } from "@/lib/format";
import { needsQuantity, serviceUnits, type CustomServiceDraft, type CustomServiceErrors, type SelectedServiceDraft, type ServiceModeChoice, type ServiceUnitChoice } from "@/lib/quote-validation";
import "./quote-service-scheme.css";

interface Props {
  terms: TermMonths[];
  licenseOnly?: boolean;
  catalog: QuoteCatalog;
  mode: ServiceModeChoice;
  onModeChange: (mode: ServiceModeChoice) => void;
  packageType: ServicePackageType | null;
  onPackageChange: (pkg: ServicePackageType) => void;
  packageError?: string | null;
  selected: SelectedServiceDraft[];
  onSelectedChange: (next: SelectedServiceDraft[]) => void;
  selectedErrors: Record<string, string>;
  custom: CustomServiceDraft[];
  onCustomChange: (next: CustomServiceDraft[]) => void;
  customErrors: CustomServiceErrors[];
}

export default function QuoteServiceScheme({ catalog, terms, licenseOnly, selected, onSelectedChange, selectedErrors, custom, onCustomChange, customErrors }: Props) {
  const active = catalog.individualServices.filter(s => s.active);
  const obsolete = selected.filter(s => !active.some(a => a.id === s.id));
  const patchSelected = (id: string, quantity: string) => onSelectedChange(selected.map(s => s.id === id ? { ...s, quantity } : s));
  const patchCustom = (index: number, patch: Partial<CustomServiceDraft>) => onCustomChange(custom.map((c, i) => i === index ? { ...c, ...patch } : c));

  return <section className="panel package-panel animate-enter delay-3">
    <div className="section-heading"><div className="section-number">03</div><div><h2>Esquema de servicios</h2><p>Servicios individuales, financiados con residual 0 % y aplicados solo a equipos.</p></div></div>
    {licenseOnly && <div className="quote-validation" role="status">Los servicios se aplican a equipos; esta cotización solo contiene licenciamiento.</div>}
    <div className="service-catalog" data-testid="list-individual-services">
      {active.length === 0 && obsolete.length === 0 && <div className="quote-validation">No hay servicios activos en el catálogo. Puede añadir un servicio nuevo.</div>}
      {active.map(service => {
        const item = selected.find(s => s.id === service.id);
        const err = selectedErrors[service.id];
        return <div key={service.id} className={`service-item ${item ? "checked" : ""} ${err ? "invalid-row" : ""}`} data-testid={`row-service-${service.id}`}>
          <label className="service-check">
            <input type="checkbox" data-testid={`checkbox-service-${service.id}`} checked={Boolean(item)} disabled={service.mandatory}
              onChange={e => onSelectedChange(e.target.checked ? [...selected, { id: service.id, name: service.name, quantity: "" }] : selected.filter(s => s.id !== service.id))} />
            <span className="service-name"><strong>{service.name}</strong>{service.mandatory && <em className="mandatory-tag"><Lock size={11} /> Obligatorio</em>}</span>
          </label>
          <span className="service-unit">{service.unit}</span>
          <span className="service-cost mono">{currency(service.unitCost)}</span>
          {item && needsQuantity(service.unit) && <label className="field service-qty"><span>{service.unit === "Por equipo saliente" ? "Cantidad de equipos salientes" : "Cantidad"}</span><input type="number" min="1" step="1" data-testid={`input-service-quantity-${service.id}`} aria-label={service.unit === "Por equipo saliente" ? `Cantidad de equipos salientes · ${service.name}` : `Cantidad de ${service.name}`} aria-invalid={Boolean(err)} value={item.quantity} onChange={e => patchSelected(service.id, e.target.value)} /></label>}
          {item && service.unit === "Por equipo por evento" && <div className="service-events">{terms.map(term => <label className="field" key={term}><span>Nº de mantenimientos en el periodo · {term} meses</span><input required={!licenseOnly} type="number" min="1" step="1" data-testid={`input-service-events-${service.id}-${term}`} value={item.events?.[term] ?? ""} onChange={e => onSelectedChange(selected.map(s => s.id === service.id ? { ...s, events: { ...s.events, [term]: e.target.value } } : s))} /></label>)}</div>}
          {err && <p className="field-error service-error">{err}</p>}
        </div>;
      })}
      {obsolete.map(item => <div key={item.id} className="service-item checked invalid-row" data-testid={`row-service-obsolete-${item.id}`}>
        <label className="service-check">
          <input type="checkbox" checked data-testid={`checkbox-service-${item.id}`} onChange={() => onSelectedChange(selected.filter(s => s.id !== item.id))} />
          <span className="service-name"><strong>{item.name ?? item.id}</strong><em className="obsolete-tag">No disponible</em></span>
        </label>
        <p className="field-error service-error">{selectedErrors[item.id] ?? "Servicio no disponible. Desmárquelo para continuar."}</p>
      </div>)}
    </div>

    <div className="custom-services">
      <div className="custom-head"><strong>Servicios nuevos</strong><small>Solo para esta cotización; no se añaden al catálogo.</small></div>
      {custom.map((item, index) => {
        const err = customErrors[index] ?? {};
        return <article key={item.id} className={`custom-service ${Object.keys(err).length ? "invalid-row" : ""}`} data-testid={`row-custom-service-${index}`}>
          <label className="field cs-name"><span>Nombre del servicio <b>Obligatorio</b></span><input data-testid={`input-custom-service-name-${index}`} maxLength={200} aria-invalid={Boolean(err.name)} value={item.name} onChange={e => patchCustom(index, { name: e.target.value })} placeholder="Ej. Borrado certificado" /></label>
          <label className="field cs-cost"><span>Costo USD antes de IVA</span><div className={`input-prefix ${err.unitCost ? "invalid-control" : ""}`}><i>USD</i><input type="text" inputMode="decimal" data-testid={`input-custom-service-cost-${index}`} aria-invalid={Boolean(err.unitCost)} value={item.unitCost} onChange={e => patchCustom(index, { unitCost: e.target.value })} placeholder="0,00" /></div></label>
          <label className="field cs-unit"><span>Unidad de medida</span><select data-testid={`select-custom-service-unit-${index}`} value={item.unit} onChange={e => patchCustom(index, { unit: e.target.value as ServiceUnitChoice })}>{serviceUnits.map(u => <option key={u}>{u}</option>)}</select></label>
          {needsQuantity(item.unit) && <label className="field cs-qty"><span>Cantidad</span><input type="number" min="1" step="1" data-testid={`input-custom-service-quantity-${index}`} aria-invalid={Boolean(err.quantity)} value={item.quantity} onChange={e => patchCustom(index, { quantity: e.target.value })} /></label>}
          {item.unit === "Por equipo por evento" && <div className="service-events">{terms.map(term => <label className="field" key={term}><span>Nº de eventos · {term} meses</span><input type="number" min="1" step="1" value={item.events?.[term] ?? ""} onChange={e => patchCustom(index, { events: { ...item.events, [term]: e.target.value } })} /></label>)}</div>}
          <button type="button" className="icon-button danger-icon cs-remove" data-testid={`button-remove-custom-service-${index}`} title="Eliminar servicio" aria-label={`Eliminar servicio nuevo ${index + 1}`} onClick={() => onCustomChange(custom.filter((_, i) => i !== index))}><Trash2 size={15} /></button>
          {Object.values(err).length > 0 && <div className="row-validation">{Object.values(err).map(m => <p className="field-error" key={m}>{m}</p>)}</div>}
        </article>;
      })}
      <button type="button" className="add-row" data-testid="button-add-custom-service" onClick={() => onCustomChange([...custom, { id: crypto.randomUUID(), name: "", unitCost: "", unit: "Por equipo", quantity: "1" }])}><Plus size={16} /> Añadir servicio nuevo <span>Fuera del catálogo</span></button>
    </div>
  </section>;
}
