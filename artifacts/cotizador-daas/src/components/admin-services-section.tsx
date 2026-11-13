import { Plus, Power, RotateCcw } from "lucide-react";
import type { IndividualService, IndividualServiceUnit } from "@workspace/api-client-react";

export const serviceUnits: IndividualServiceUnit[] = ["Por equipo", "Por perfil", "Por evento", "Por año", "Por equipo saliente", "Por equipo por evento"];

export function serviceErrors(services: IndividualService[], costInputs: Record<string, string>): string | null {
  for (const s of services) {
    const label = s.name.trim() || "Servicio sin nombre";
    if (!s.name.trim()) return "Cada servicio necesita un nombre.";
    const raw = costInputs[s.id] ?? String(s.unitCost);
    if (raw.trim() === "" || !Number.isFinite(Number(raw)) || Number(raw) < 0) return `${label}: el costo debe ser un valor USD no negativo.`;
    if (!serviceUnits.includes(s.unit)) return `${label}: seleccione una unidad válida.`;
  }
  return null;
}

export function AdminServicesSection({ services, costInputs, onChange, onCostInput }: {
  services: IndividualService[];
  costInputs: Record<string, string>;
  onChange: (next: IndividualService[]) => void;
  onCostInput: (id: string, value: string) => void;
}) {
  const patch = (id: string, changes: Partial<IndividualService>) => onChange(services.map(s => s.id === id ? { ...s, ...changes } : s));
  const add = () => onChange([...services, { id: crypto.randomUUID(), name: "", unitCost: 0, unit: "Por equipo", mandatory: false, active: true }]);
  const error = serviceErrors(services, costInputs);
  return <section className="panel animate-enter delay-3">
    <div className="section-heading"><div className="section-number">06</div><div><h2>Catálogo de servicios individuales</h2><p>Los servicios no se eliminan: desactívelos para retirarlos de nuevas cotizaciones.</p></div></div>
    {services.length === 0 && <p className="admin-reference-note" data-testid="text-services-empty">Aún no hay servicios individuales. Agregue el primero para ofrecerlo en las propuestas.</p>}
    <div className="service-catalog-list">{services.map((s, index) => {
      const cost = costInputs[s.id] ?? String(s.unitCost);
      const costInvalid = cost.trim() === "" || !Number.isFinite(Number(cost)) || Number(cost) < 0;
      return <article className={`service-catalog-row${s.active ? "" : " is-inactive"}`} key={s.id} data-testid={`row-service-${s.id}`}>
        <span className="asset-table-icon">{String(index + 1).padStart(2, "0")}</span>
        <label className="field"><span>Nombre</span><input data-testid={`input-service-name-${s.id}`} maxLength={200} value={s.name} aria-invalid={!s.name.trim()} onChange={e => patch(s.id, { name: e.target.value })} /></label>
        <label className="field"><span>Costo USD</span><div className="input-prefix"><i>USD</i><input data-testid={`input-service-unitcost-${s.id}`} type="number" min="0" step="0.01" value={cost} aria-invalid={costInvalid} onChange={e => { onCostInput(s.id, e.target.value); const n = Number(e.target.value); patch(s.id, { unitCost: e.target.value.trim() !== "" && Number.isFinite(n) ? n : NaN }); }} /></div></label>
        <label className="field"><span>Unidad</span><select data-testid={`select-service-unit-${s.id}`} value={s.unit} onChange={e => patch(s.id, { unit: e.target.value as IndividualServiceUnit })}>{serviceUnits.map(u => <option key={u} value={u}>{u}</option>)}</select></label>
        <label className="service-check"><input type="checkbox" data-testid={`checkbox-service-mandatory-${s.id}`} checked={s.mandatory} onChange={e => patch(s.id, { mandatory: e.target.checked })} /><span>Obligatorio</span></label>
        <div className="service-state">
          <span className={`service-badge${s.active ? "" : " off"}`} data-testid={`status-service-${s.id}`}>{s.active ? "Activo" : "Inactivo"}</span>
          <button type="button" className="button" data-testid={`button-toggle-service-${s.id}`} onClick={() => patch(s.id, { active: !s.active })}>{s.active ? <><Power size={13} /> Desactivar</> : <><RotateCcw size={13} /> Reactivar</>}</button>
        </div>
      </article>;
    })}</div>
    <button type="button" className="button add-service" data-testid="button-add-service" onClick={add}><Plus size={14} /> Agregar servicio</button>
    {error && <p className="field-error" role="alert" data-testid="text-service-error">{error}</p>}
  </section>;
}
