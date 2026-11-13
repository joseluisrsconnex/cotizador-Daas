import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CircleHelp, Save, Settings2 } from "lucide-react";
import { Link } from "wouter";
import { getGetDaasConfigQueryKey, getGetPricingConfigHistoryQueryKey, getGetQuoteCatalogQueryKey, useGetPricingConfigHistory, useGetDaasConfig, useUpdateDaasConfig } from "@workspace/api-client-react";
import type { AssetType, PricingConfig, TermMonths } from "@workspace/api-client-react";
import { validatePricingConfig } from "@workspace/pricing";
import { normalizePricingConfig, percentToFraction } from "@workspace/pricing/normalization";
import { usePageMetadata } from "@/hooks/use-page-metadata";
import { BRAND } from "@/lib/brand";
import { AdminMarginsSection, marginErrors, marginInputsFrom, type MarginInputs } from "@/components/admin-margins-section";
import { AdminServicesSection, serviceErrors } from "@/components/admin-services-section";
import AdminBusinessParameters from "@/components/admin-business-parameters";
import "@/components/funding-rates.css";

const assetTypes: AssetType[] = ["Laptop", "Desktop", "AIO", "Equipo Apple", "Movilidad", "Infraestructura", "Impresión", "Accesorios", "HW Seguridad", "Equipos POS", "Licenciamiento"];
const terms: TermMonths[] = [12, 24, 36, 48, 60];
const pct = (fraction: number) => `${(fraction * 100).toLocaleString("es-ES", { maximumFractionDigits: 2 })}%`;

export default function AdminPage() {
  usePageMetadata(`${BRAND.applicationName} · Administración`, "Novotechno: administre tasas, spare, residuales, márgenes por plazo, paquetes y servicios del cotizador DaaS.");
  const queryClient = useQueryClient();
  const queryKey = getGetDaasConfigQueryKey();
  const { data, isLoading, isError, refetch } = useGetDaasConfig({ query: { queryKey } });
  const mutation = useUpdateDaasConfig();
  const history = useGetPricingConfigHistory();
  const historyAnchorHandled = useRef(false);
  const [draft, setDraft] = useState<PricingConfig | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [marginInputs, setMarginInputs] = useState<MarginInputs>({});
  const [costInputs, setCostInputs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!draft || historyAnchorHandled.current || window.location.hash !== "#historial-de-cambios") return;
    document.getElementById("historial-de-cambios")?.scrollIntoView();
    historyAnchorHandled.current = true;
  }, [Boolean(draft)]);
  useEffect(() => {
    if (data && !isDirty) {
      setDraft(structuredClone(data));
      setMarginInputs(marginInputsFrom(data.margins));
      setCostInputs({});
    }
  }, [data, isDirty]);
  const marginError = draft ? marginErrors(draft.margins, marginInputs) : null;
  const serviceError = draft ? serviceErrors(draft.individualServices, costInputs) : null;
  const invalidMarginInputs = !draft || Boolean(marginError) || Boolean(serviceError);
  const update = <K extends keyof PricingConfig>(key: K, value: PricingConfig[K]) => {
    setIsDirty(true);
    setValidationError(null);
    if (mutation.isSuccess || mutation.isError) mutation.reset();
    setDraft((current) => current ? { ...current, [key]: value } : current);
  };
  const save = () => {
    if (!draft) return;
    if (invalidMarginInputs) {
      setValidationError(marginError ?? serviceError ?? "Revise la configuración.");
      return;
    }
    let normalized: PricingConfig;
    try {
      normalized = normalizePricingConfig(draft);
      validatePricingConfig(normalized);
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Revise la configuración.");
      return;
    }
    mutation.mutate({ data: normalized }, {
      onSuccess: (saved) => {
        setValidationError(null);
        setDraft(structuredClone(saved));
        setMarginInputs(marginInputsFrom(saved.margins));
        setCostInputs({});
        setIsDirty(false);
        queryClient.setQueryData(queryKey, saved);
        void queryClient.invalidateQueries({ queryKey });
        void queryClient.invalidateQueries({ queryKey: getGetPricingConfigHistoryQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetQuoteCatalogQueryKey() });
        void queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith("/api/quotes/preview") });
      },
    });
  };

  if (isLoading || !draft && !isError) return <main className="page-wrap"><div className="skeleton-heading" /><div className="skeleton-panel" /><div className="skeleton-panel" /></main>;
  if (isError || !draft) return <main className="page-wrap"><section className="notice error"><h1>No se pudo cargar la configuración</h1><p>Los parámetros financieros no están disponibles en este momento.</p><button className="button primary" onClick={() => void refetch()}>Reintentar</button></section></main>;

  return <main className="page-wrap admin-page">
    <header className="admin-heading animate-enter"><div><Link href="/cotizador" className="back-link"><ArrowLeft size={15} /> Volver al cotizador</Link><div className="eyebrow"><span className="eyebrow-mark" /> ADMINISTRACIÓN <span className="eyebrow-line" /></div><h1>Parámetros de<br /><span>rentabilidad.</span></h1><p className="intro">Configure las reglas que sostienen cada propuesta comercial.</p></div><div className="admin-badge"><Settings2 size={17} /><span>CONFIGURACIÓN<br /><b>FINANCIERA</b></span></div></header>
    <fieldset className="admin-content" disabled={mutation.isPending}>
      <AdminBusinessParameters config={draft} onChange={next => {
        update("commercialMargin", next.commercialMargin);
        update("profitAndLoss", next.profitAndLoss);
      }} />
      <section className="panel animate-enter delay-1">
        <div className="section-heading"><div className="section-number">01</div><div><h2>Colocación mensual</h2><p>Factor mensual aplicado al costo financiado del activo.</p></div><CircleHelp size={16} className="help-icon" /></div>
        <div className="rate-control funding-rate-controls"><label className="field"><span>Tasa de colocación mensual</span><div className="input-suffix wide-input"><input data-testid="input-placement-rate" type="number" min="0" max="99.99" step="0.01" value={Number((draft.monthlyPlacementRate * 100).toFixed(8))} onChange={(e) => update("monthlyPlacementRate", Math.max(0, Math.min(.9999, percentToFraction(e.target.value || 0))))} /><i>%</i></div></label>
          <label className="field"><span>Tasa de captación mensual (%)</span><div className="input-suffix wide-input"><input data-testid="input-funding-rate" type="number" min="0" max="10" step="0.0001" value={Number((draft.monthlyFundingRate * 100).toFixed(4))} onChange={e => update("monthlyFundingRate", percentToFraction(e.target.value || 0))} /><i>%</i></div><small>Solo afecta la rentabilidad neta, no el canon. Rango: 0 a 10 %.</small></label>
          <div className="rate-readout"><span>TASA EFECTIVA</span><b className="mono">{pct(draft.monthlyPlacementRate)}</b><small>por mes</small></div></div>
      </section>
      <section className="panel animate-enter delay-1">
        <div className="section-heading"><div className="section-number">02</div><div><h2>Base para spare (unidades)</h2><p>Base utilizada por la fórmula de spare para cada tipo de activo.</p></div></div>
        <div className="config-table-wrap"><table className="config-table"><thead><tr><th>TIPO DE ACTIVO</th><th>BASE SPARE (UNIDADES)</th></tr></thead><tbody>{draft.spareBases.map((item, index) => <tr key={item.assetType}><td><span className="asset-table-icon">{String(index + 1).padStart(2, "0")}</span>{item.assetType}</td><td><input aria-label={`Base spare ${item.assetType}`} data-testid={`input-spares-${index}`} type="number" min="1" step="1" value={item.units} onChange={(e) => update("spareBases", draft.spareBases.map((row, i) => i === index ? { ...row, units: Math.max(1, Math.floor(Number(e.target.value) || 1)) } : row))} /></td></tr>)}</tbody></table></div>
      </section>
      <section className="panel animate-enter delay-2">
        <div className="section-heading"><div className="section-number">03</div><div><h2>Valor residual por plazo</h2><p>Fracción de valor recuperable al finalizar el contrato.</p></div></div>
        <div className="residual-grid">{terms.map((term) => { const group = draft.residuals.find((item) => item.termMonths === term); return <div className="term-card" key={term}><div className="term-card-head"><strong>{term}<small> meses</small></strong><span>VALOR RESIDUAL</span></div><div className="residual-rows">{assetTypes.map((type) => { const asset = group?.assets.find((item) => item.assetType === type); const value = asset?.fraction ?? 0; return <label className="residual-row" key={type}><span>{type}</span><div className="input-suffix"><input data-testid={`input-residual-${term}-${assetTypes.indexOf(type)}`} type="number" min="0" max="100" step="0.1" value={(value * 100).toFixed(1)} onChange={(e) => update("residuals", draft.residuals.map((entry) => entry.termMonths !== term ? entry : { ...entry, assets: entry.assets.map((a) => a.assetType === type ? { ...a, fraction: Math.max(0, Math.min(1, Number(e.target.value) / 100 || 0)) } : a) }))} /><i>%</i></div></label>; })}</div></div>; })}</div>
      </section>
      <AdminMarginsSection margins={draft.margins} inputs={marginInputs} onChange={(term, field, value) => {
        setMarginInputs(current => ({ ...current, [term]: { ...current[term], [field]: value } }));
        update("margins", draft.margins.map(row => row.termMonths === term ?
          { ...row, [field]: value.trim() === "" || !Number.isFinite(Number(value)) ? NaN : percentToFraction(value) } : row));
      }} />
      <AdminServicesSection services={draft.individualServices} costInputs={costInputs} onCostInput={(id, value) => setCostInputs(c => ({ ...c, [id]: value }))} onChange={(next) => update("individualServices", next)} />
      <div className="save-bar"><div><span className="save-status" role={validationError || mutation.isError ? "alert" : "status"}>{validationError ?? (mutation.isSuccess ? <><Check size={14} /> Cambios guardados</> : mutation.isError ? "No se pudieron guardar los cambios" : "Los cambios se aplicarán a nuevas cotizaciones")}</span><small>La configuración se guarda de forma centralizada.</small></div><button className="button primary save-button" data-testid="button-save-config" disabled={mutation.isPending || invalidMarginInputs} onClick={save}><Save size={16} />{mutation.isPending ? "Guardando…" : "Guardar configuración"}</button></div>
    </fieldset>
    <section className="panel" id="historial-de-cambios" aria-labelledby="pricing-history-title">
      <h2 id="pricing-history-title">Historial de cambios</h2>
      {history.isLoading ? <p aria-busy="true">Cargando historial…</p>
        : history.isError ? <div role="alert"><p>No se pudo cargar el historial.</p><button className="button" onClick={() => void history.refetch()}>Reintentar</button></div>
        : !history.data?.items.length ? <p>No hay cambios registrados.</p>
        : <div className="config-table-wrap"><table className="config-table"><thead><tr><th>FECHA</th><th>CAMBIOS</th></tr></thead>
          <tbody>{history.data.items.map(item => <tr key={item.id}><td>{new Date(item.appliedAt).toLocaleString("es-CO")}</td><td>{item.reason}</td></tr>)}</tbody>
        </table></div>}
    </section>
  </main>;
}
