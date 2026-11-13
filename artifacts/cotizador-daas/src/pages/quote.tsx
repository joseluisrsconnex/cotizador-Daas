import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Copy, Trash2, ArrowUpRight, Settings2 } from "lucide-react";
import { getGetSavedQuotesQueryKey, previewQuote, useCreateSavedQuote, useCreateQuoteVersion, useGetQuoteCatalog, useGetSavedQuote, getGetSavedQuoteQueryKey, getGetQuoteVersionsQueryKey } from "@workspace/api-client-react";
import type { AssetType, DeliveryStatus, QuoteDraftInput, QuoteRowInput, SavedQuote, ServicePackageType, TermMonths } from "@workspace/api-client-react";
import QuoteSummaryTable from "@/components/quote-summary-table";
import { formatUsd as currency } from "@/lib/format";
import { usePageMetadata } from "@/hooks/use-page-metadata";
import { BRAND } from "@/lib/brand";
import WarrantyNotice from "@/components/warranty-notice";
import { changeAssetType, quoteCodeError, extensionLabel, longerTerms, shortestTerm, warrantyIncludedLabel, type DeliveryChoice, type ExtensionDrafts, parseDecimalInput, validateQuoteDraft, validateServiceScheme, type CustomServiceDraft, type QuoteDraftRow, type SelectedServiceDraft, type ServiceModeChoice } from "@/lib/quote-validation";
import QuoteServiceScheme from "@/components/quote-service-scheme";
import { pruneServiceEvents } from "@/lib/quote-validation";
import { useAppSession } from "@/hooks/use-app-session";
import TermPicker from "@/components/term-picker";
import { toCalculatedRows, toScenario } from "@/lib/saved-quote";
import { apiErrorMessage } from "@/lib/api-errors";

function restoreServices(source: SavedQuote) {
  const names = new Map(source.includedServices.map(s => [s.id, s.name]));
  return {
    mode: "Servicios individuales" as ServiceModeChoice,
    selected: source.serviceMode === "Paquete" ? [] : source.selectedServices.map(s => ({ id: s.id, name: names.get(s.id), quantity: String(s.quantity ?? ""), events: Object.fromEntries((s.events ?? []).map(e => [e.termMonths, String(e.quantity)])) })),
    custom: source.customServices.map(c => ({ id: c.id, name: c.name, unitCost: String(c.unitCost), unit: c.unit, quantity: String(c.quantity ?? ""), events: Object.fromEntries((c.events ?? []).map(e => [e.termMonths, String(e.quantity)])) })),
  };
}
const emptyRow = (): QuoteDraftRow => ({ assetType: "Laptop", reference: "", quantity: 1, unitCost: "", extensions: {} });
/** Restores every row with its base cost and raw warranty extensions per term. */
const restoreRows = (source: SavedQuote): QuoteDraftRow[] => source.rows.map(({ warrantyExtensions, ...row }) => ({
  ...row, unitCost: String(row.unitCost),
  extensions: Object.fromEntries((warrantyExtensions ?? []).map(e => [e.termMonths, String(e.unitCost)])) as ExtensionDrafts,
}));
const restoreTerms = (source: SavedQuote): TermMonths[] => source.terms?.length ? source.terms : [source.termMonths];
const toApiRow = ({ warrantyExtensions, ...row }: QuoteDraftRowOut): QuoteRowInput => ({ ...row, ...(warrantyExtensions?.length ? { warrantyExtensions } : {}) });
type QuoteDraftRowOut = ReturnType<typeof validateQuoteDraft>["rows"][number];

export default function QuotePage() {
  usePageMetadata(BRAND.applicationName, "Novotechno: cotice equipos y servicios DaaS con cánones mensuales en USD antes de IVA.");
  const { user } = useAppSession();
  const { data: catalog, isLoading, isError, refetch } = useGetQuoteCatalog({
    query: { queryKey: ["quote-catalog", user?.id], enabled: Boolean(user) },
  });
  const [, setLocation] = useLocation();
  const search = useSearch();
  const duplicateId = new URLSearchParams(search).get("duplicate") ?? "";
  const duplicate = useGetSavedQuote(duplicateId, { query: { enabled: Boolean(duplicateId),
    queryKey: ["duplicate-source", duplicateId, user?.id], retry: false } });
  const editId = new URLSearchParams(search).get("edit") ?? "";
  const edit = useGetSavedQuote(editId, { query: { enabled: Boolean(editId && user),
    queryKey: [...getGetSavedQuoteQueryKey(editId), user?.id], retry: false } });
  const versionMutation = useCreateQuoteVersion();
  const editLoaded = useRef("");
  const editSnapshot = useRef<SavedQuote | null>(null);
  const duplicateLoaded = useRef("");
  const saveAttempt = useRef({ fingerprint: "", id: "" });
  const savedDraft = useRef<{ fingerprint: string; record: SavedQuote } | null>(null);
  const saveMutation = useCreateSavedQuote();
  const queryClient = useQueryClient();
  const [saveError, setSaveError] = useState("");
  const [customer, setCustomer] = useState("");
  const [quoteCode, setQuoteCode] = useState("");
  const [quoteCodeTouched, setQuoteCodeTouched] = useState(false);
  const [customerTouched, setCustomerTouched] = useState(false);
  const [terms, setTerms] = useState<TermMonths[]>([36]);
  const [deliveryStatus, setDeliveryStatus] = useState<DeliveryChoice>("");
  const term = shortestTerm(terms);
  const extensionTerms = longerTerms(terms);
  const [packageType, setPackageType] = useState<ServicePackageType | null>(null);
  const [rows, setRows] = useState<QuoteDraftRow[]>([emptyRow()]);
  const [serviceMode, setServiceMode] = useState<ServiceModeChoice>("Servicios individuales");
  const [selectedServices, setSelectedServices] = useState<SelectedServiceDraft[]>([]);
  const [customServices, setCustomServices] = useState<CustomServiceDraft[]>([]);
  const physicalUnits = rows.reduce((sum, row) => sum + (row.assetType === "Licenciamiento" ? 0 : row.quantity), 0);
  useEffect(() => {
    setSelectedServices(current => pruneServiceEvents(current, terms));
    setCustomServices(current => pruneServiceEvents(current, terms));
  }, [terms]);
  const assetTypes = catalog?.assetTypes ?? [];
  const applyServices = (source: SavedQuote) => {
    const restored = restoreServices(source);
    setServiceMode(restored.mode); setSelectedServices(restored.selected); setCustomServices(restored.custom);
  };
  useEffect(() => {
    if (!catalog || serviceMode !== "Servicios individuales") return;
    const missing = catalog.individualServices.filter(s => s.active && s.mandatory && !selectedServices.some(x => x.id === s.id));
    if (missing.length) setSelectedServices(current => [...current, ...missing.filter(m => !current.some(c => c.id === m.id)).map(m => ({ id: m.id, name: m.name, quantity: "1" }))]);
  }, [catalog, serviceMode, selectedServices]);
  useEffect(() => {
    if (!duplicate.data || !catalog || duplicateLoaded.current === duplicateId) return;
    const source = duplicate.data;
    savedDraft.current = null;
    editSnapshot.current = null;
    setCustomer(source.customer);
    setQuoteCode("");
    setQuoteCodeTouched(false);
    setTerms(restoreTerms(source)); setDeliveryStatus(source.deliveryStatus ?? "");
    setPackageType(source.packageType);
    setRows(restoreRows(source));
    applyServices(source);
    duplicateLoaded.current = duplicateId;
  }, [duplicate.data, duplicateId, catalog]);
  useEffect(() => {
    if (!edit.data || !catalog || editLoaded.current === editId) return;
    const source = edit.data;
    savedDraft.current = null;
    editSnapshot.current = source;
    setCustomer(source.customer); setTerms(restoreTerms(source)); setDeliveryStatus(source.deliveryStatus ?? ""); setPackageType(source.packageType);
    setQuoteCode(source.quoteCode);
    setRows(restoreRows(source));
    applyServices(source);
    editLoaded.current = editId;
  }, [edit.data, editId, catalog]);
  const validation = useMemo(() => catalog
    ? validateQuoteDraft({ customer, packageType, serviceMode, rows, terms, deliveryStatus }, catalog)
    : null, [catalog, customer, packageType, serviceMode, rows, terms, deliveryStatus]);
  const serviceValidation = useMemo(() => catalog
    ? validateServiceScheme({ serviceMode, selectedServices, customServices, terms, physicalUnits }, catalog)
    : null, [catalog, serviceMode, selectedServices, customServices, terms, physicalUnits]);
  const individual = serviceMode === "Servicios individuales";
  const draftInput: QuoteDraftInput | null = validation && serviceValidation && validation.errors.length === 0 && serviceValidation.errors.length === 0 && (individual || packageType) && term && deliveryStatus
    ? { deliveryStatus: deliveryStatus as DeliveryStatus, termMonths: term, terms, packageType: individual ? null : packageType, serviceMode,
      selectedServices: individual ? serviceValidation.selectedServices : [],
      customServices: serviceValidation.customServices, rows: validation.rows.map(toApiRow) } : null;
  const draftSignature = draftInput ? JSON.stringify(draftInput) : "";
  const [previewInput, setPreviewInput] = useState<{ signature: string; payload: QuoteDraftInput } | null>(null);
  useEffect(() => {
    const pending = setTimeout(() => setPreviewInput(draftInput ? { signature: draftSignature, payload: draftInput } : null), 250);
    return () => clearTimeout(pending);
  }, [draftSignature]);
  const previewQuery = useQuery({
    queryKey: ["quote-preview", user?.id, editId, duplicateId, previewInput?.signature],
    enabled: Boolean(previewInput && user),
    queryFn: () => previewQuote(previewInput!.payload),
    retry: false,
  });
  const preview = previewInput?.signature === draftSignature && draftInput && !previewQuery.isFetching
    ? previewQuery.data : undefined;
  const scenarios = useMemo(() => preview
    ? (preview.scenarios?.length ? preview.scenarios : [{ termMonths: term ?? 36, results: preview.results, totalMonthlyBeforeTax: preview.totalMonthlyBeforeTax }]).map(toScenario)
    : terms.map(t => ({ termMonths: t, calculatedRows: [], total: undefined })), [preview, terms, term]);
  const primaryScenario = preview ? scenarios[0] : undefined;
  const pricedRows = primaryScenario?.calculatedRows ?? (preview ? toCalculatedRows(preview.results) : []);
  const total = primaryScenario?.total;
  const previewError = previewInput?.signature === draftSignature && previewQuery.isError
    ? previewQuery.error instanceof Error ? previewQuery.error.message : "No fue posible calcular la cotización." : null;
  const idError = quoteCodeError(quoteCode);
  const blockingErrors = [...(validation?.errors ?? []), ...(idError ? [idError] : []), ...(serviceValidation?.errors ?? []), ...(previewError ? [previewError] : []), ...(preview?.blockingErrors ?? [])];
  const includedServices = preview?.includedServices ?? (catalog ? [
    ...(individual ? selectedServices.flatMap(item => {
      const service = catalog.individualServices.find(s => s.id === item.id);
      if (!service) return [];
      const quantity = parseInt(item.quantity, 10);
      return [{ id: service.id, name: service.name, unitCost: service.unitCost, unit: service.unit, ...(["Por perfil", "Por evento"].includes(service.unit) && quantity > 0 ? { quantity } : {}) }];
    }) : []),
    ...customServices.map(item => {
      const quantity = parseInt(item.quantity, 10);
      return { id: item.id, name: item.name.trim() || "Servicio sin nombre", unitCost: parseDecimalInput(item.unitCost) ?? 0, unit: item.unit, ...(["Por perfil", "Por evento"].includes(item.unit) && quantity > 0 ? { quantity } : {}) };
    }),
  ] : []);
  // Client-facing rows never include warranty extension costs.
  const numericRows = (validation?.rows ?? rows.map(({ extensions: _e, ...row }) => ({ ...row, unitCost: parseDecimalInput(row.unitCost) ?? NaN })))
    .map(({ warrantyExtensions: _w, ...row }: QuoteDraftRowOut) => row);
  const updateExtension = (index: number, t: TermMonths, value: string) =>
    setRows(existing => existing.map((row, i) => i === index ? { ...row, extensions: { ...row.extensions, [t]: value } } : row));
  const update = (index: number, patch: Partial<QuoteDraftRow>) => setRows((existing) => existing.map((row, i) => i === index ? { ...row, ...patch } : row));
  const saveQuote = async (navigate = true): Promise<SavedQuote> => {
    if (!preview || !draftInput || blockingErrors.length || saveMutation.isPending || versionMutation.isPending)
      throw new Error("Complete la cotización antes de guardarla.");
    const payload = { ...draftInput, customer: customer.trim(), quoteCode: quoteCode.trim(), expectedRevision: preview.configRevision };
    const fingerprint = JSON.stringify(payload);
    if (savedDraft.current?.fingerprint === fingerprint) {
      if (navigate) setLocation(`/cotizaciones/${savedDraft.current.record.id}`);
      return savedDraft.current.record;
    }
    if (saveAttempt.current.fingerprint !== fingerprint) saveAttempt.current = { fingerprint, id: crypto.randomUUID() };
    setSaveError("");
    const source = savedDraft.current?.record ?? (editId ? editSnapshot.current : null);
    if (editId && !source) throw new Error("No se ha cargado la versión de origen.");
    try {
      const saved = source
        ? await versionMutation.mutateAsync({ id: source.id, data: { ...payload, requestId: saveAttempt.current.id, baseVersionId: source.currentVersionId } })
        : await saveMutation.mutateAsync({ data: { ...payload, requestId: saveAttempt.current.id } });
      savedDraft.current = { fingerprint, record: saved };
      void queryClient.invalidateQueries({ queryKey: getGetSavedQuotesQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetSavedQuoteQueryKey(saved.id) });
      void queryClient.invalidateQueries({ queryKey: getGetQuoteVersionsQueryKey(saved.id) });
      void queryClient.invalidateQueries({ predicate: q => typeof q.queryKey[0] === "string" &&
        q.queryKey[0].startsWith(`${getGetSavedQuoteQueryKey(saved.id)[0]}/versions/`) });
      if (navigate) setLocation(`/cotizaciones/${saved.id}`);
      return saved;
    } catch (error) {
      setSaveError(apiErrorMessage(error, "No se pudo guardar la cotización."));
      throw error;
    }
  };

  if (isLoading) return <main className="page-wrap"><div className="skeleton-heading" /><div className="skeleton-panel" /><div className="skeleton-panel" /></main>;
  if (isError || !catalog) return <main className="page-wrap"><section className="notice error"><h1>No se pudo cargar el catálogo</h1><p>Revisa la conexión e inténtalo de nuevo.</p><button className="button primary" onClick={() => void refetch()}>Reintentar</button></section></main>;
  if (editId && edit.isLoading) return <main className="page-wrap"><div className="skeleton-panel" /></main>;
  if (editId && (edit.isError || edit.data?.deletedAt)) return <main className="page-wrap"><section className="notice error"><h1>No se pudo editar la cotización</h1><p>La cotización no existe, fue eliminada o no tiene acceso a ella.</p><Link href="/cotizaciones" className="button primary">Volver a cotizaciones</Link></section></main>;
  if (duplicateId && duplicate.isLoading) return <main className="page-wrap"><div className="skeleton-panel" /></main>;
  if (duplicateId && duplicate.isError) return <main className="page-wrap"><section className="notice error"><h1>No se pudo duplicar la cotización</h1><p>La cotización no existe o no tiene acceso a ella.</p><Link href="/cotizaciones" className="button primary">Volver al historial</Link></section></main>;

  return <main className="page-wrap">
    <header className="page-heading animate-enter">
      <div><div className="eyebrow"><span className="eyebrow-mark" /> PROPUESTA COMERCIAL <span className="eyebrow-line" /></div><h1>Una cuota clara.<br /><span>Un equipo listo.</span></h1><p className="intro">Configure los activos y obtenga el canon mensual al instante.</p></div>
      <div className="heading-stamp"><span>USD</span><strong>DAAS</strong><small>FINANCIACIÓN + SERVICIO</small></div>
    </header>
    {editId && editSnapshot.current && <div className="quote-validation" role="status">Editando {editSnapshot.current.customer}: al guardar se creará una nueva versión con el número asignado por el servidor. La versión actual (v{editSnapshot.current.versionNumber}) permanece sin cambios.</div>}
    {duplicateId && <div className="quote-validation" role="status">Duplicado como nueva cotización. Puede editarla; se aplican los parámetros actuales. La original permanece sin cambios.</div>}
    {saveError && <div className="blocking-errors" role="alert"><p>{saveError}</p><button className="button secondary" onClick={() => {
      void refetch();
      void queryClient.invalidateQueries({ queryKey: ["quote-preview", user?.id] });
    }}>Actualizar cotización</button></div>}
    <div className="workspace-grid">
      <div className="editor-column">
        <fieldset className="quote-editor-form" disabled={saveMutation.isPending || versionMutation.isPending}>
        <section className="panel animate-enter delay-1">
          <div className="section-heading"><div className="section-number">01</div><div><h2>Datos de la propuesta</h2><p>Identificación y condiciones comerciales</p></div></div>
          <div className="form-grid quote-meta">
            <label className="field wide"><span>Nombre del cliente <b>Obligatorio</b></span><input data-testid="input-customer-name" required maxLength={300} aria-required="true" aria-invalid={customerTouched && !customer.trim()} value={customer} onBlur={() => setCustomerTouched(true)} onChange={(e) => setCustomer(e.target.value)} placeholder="Nombre del cliente" />{customerTouched && !customer.trim() && <small className="field-error">El nombre del cliente es obligatorio.</small>}</label>
            <label className="field"><span>Cotización ID <b>Obligatorio</b></span><input data-testid="input-quote-code" required maxLength={50} aria-required="true" aria-invalid={quoteCodeTouched && Boolean(idError)} value={quoteCode} onBlur={() => setQuoteCodeTouched(true)} onChange={e => setQuoteCode(e.target.value)} placeholder="Cotización ID" />{quoteCodeTouched && idError && <small className="field-error">{idError}</small>}</label>
            <label className="field"><span>Estado de entrega de los activos <b>Obligatorio</b></span><select data-testid="select-delivery-status" required aria-required="true" aria-invalid={Boolean(validation?.deliveryError)} value={deliveryStatus} onChange={(e) => setDeliveryStatus(e.target.value as DeliveryChoice)}><option value="">Seleccione…</option><option value="Local">Local</option><option value="CTO">CTO</option></select>{validation?.deliveryError && <small className="field-error">{validation.deliveryError}</small>}</label>
            <TermPicker terms={terms} onChange={setTerms} error={validation?.termsError} />
          </div>
        </section>

        <section className="panel animate-enter delay-2">
          <div className="section-heading asset-title"><div className="section-number">02</div><div><h2>Activos de la propuesta</h2><p>Agregue equipos y cantidades; los importes se actualizan en vivo.</p></div><span className="count-pill">{rows.length} {rows.length === 1 ? "línea" : "líneas"}</span></div>
          <WarrantyNotice term={term} />
          <p className="cost-format-note">Costos en USD: decimales con coma o punto; sin separadores de miles ni símbolos de moneda.</p>
          <div className="asset-list">
            {rows.map((row, index) => <article className={`asset-row ${Object.keys(validation?.rowErrors[index] ?? {}).length ? "invalid-row" : ""}`} key={index} data-testid={`row-asset-${index}`}>
              <div className="asset-index">{String(index + 1).padStart(2, "0")}</div>
              <label className="field type-field"><span>Tipo de activo</span><select data-testid={`select-asset-type-${index}`} value={row.assetType} onChange={(e) => update(index, changeAssetType(row, e.target.value as AssetType))}>{assetTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
              <label className="field reference-field"><span>Referencia <b>Obligatoria</b></span><input data-testid={`input-reference-${index}`} required aria-invalid={Boolean(validation?.rowErrors[index]?.reference)} aria-describedby={`row-errors-${index}`} value={row.reference} onChange={(e) => update(index, { reference: e.target.value })} placeholder="Modelo / SKU" /></label>
              <label className="field quantity-field"><span>Unidades</span><input data-testid={`input-quantity-${index}`} type="number" min="1" step="1" required aria-invalid={Boolean(validation?.rowErrors[index]?.quantity)} aria-describedby={`row-errors-${index}`} value={row.quantity} onChange={(e) => update(index, { quantity: Number(e.target.value) })} /></label>
              <label className="field cost-field"><span>Costo unitario USD</span><div className={`input-prefix ${validation?.rowErrors[index]?.unitCost ? "invalid-control" : ""}`}><i>USD</i><input data-testid={`input-cost-${index}`} type="text" inputMode="decimal" required aria-invalid={Boolean(validation?.rowErrors[index]?.unitCost)} aria-describedby={`row-errors-${index}`} value={row.unitCost} onChange={(e) => update(index, { unitCost: e.target.value })} placeholder="0,00" /></div>{term && row.assetType !== "Licenciamiento" && <small className="warranty-included" data-testid={`text-warranty-included-${index}`}>{warrantyIncludedLabel(term)}</small>}</label>
              <div className="row-actions"><button className="icon-button" data-testid={`button-duplicate-${index}`} title="Duplicar activo" aria-label="Duplicar activo" onClick={() => setRows((current) => [...current.slice(0, index + 1), { ...row, extensions: { ...row.extensions } }, ...current.slice(index + 1)])}><Copy size={15} /></button><button className="icon-button danger-icon" data-testid={`button-remove-${index}`} title="Eliminar activo" aria-label="Eliminar activo" onClick={() => setRows((current) => current.filter((_, i) => i !== index))}><Trash2 size={15} /></button></div>
                  <div className="row-total"><span>Canon de línea</span><strong className="mono">{currency(pricedRows[index]?.canonMensualTotal)}<small> / mes</small></strong></div>
              {row.assetType !== "Licenciamiento" && extensionTerms.length > 0 && <div className="extension-grid" data-testid={`group-extensions-${index}`}>
                <p>Costo adicional por unidad sobre la garantía de {term} meses. Obligatorio; escriba 0 si no aplica.</p>
                {extensionTerms.map(t => { const issue = validation?.rowErrors[index]?.extensions?.[t]; return <label className="field cost-field" key={t}><span>{extensionLabel(t)}</span><div className={`input-prefix ${issue ? "invalid-control" : ""}`}><i>USD</i><input data-testid={`input-extension-${index}-${t}`} type="text" inputMode="decimal" required aria-required="true" aria-invalid={Boolean(issue)} aria-describedby={`row-errors-${index}`} value={row.extensions?.[t] ?? ""} onChange={(e) => updateExtension(index, t, e.target.value)} placeholder="0,00" /></div></label>; })}
              </div>}
              <div id={`row-errors-${index}`} className="row-validation" aria-live="polite">{Object.values(validation?.rowErrors[index] ?? {}).flatMap((message): string[] => typeof message === "string" ? [message] : Object.values(message ?? {}).filter((m): m is string => typeof m === "string")).map(message => <p className="field-error" key={message}>{message}</p>)}</div>
            </article>)}
          </div>
          {rows.length === 0 && <div className="quote-validation">No hay referencias. Añada un activo para empezar.</div>}
          <button className="add-row" data-testid="button-add-asset" onClick={() => setRows((current) => [...current, emptyRow()])}><Plus size={16} /> Añadir activo <span>Otra línea de cotización</span></button>
        </section>

        <QuoteServiceScheme catalog={catalog} terms={terms} licenseOnly={rows.length > 0 && rows.every(row => row.assetType === "Licenciamiento")} mode={serviceMode} onModeChange={setServiceMode} packageType={packageType} onPackageChange={setPackageType}
          packageError={validation?.packageError} selected={selectedServices} onSelectedChange={setSelectedServices} selectedErrors={serviceValidation?.selectedErrors ?? {}}
          custom={customServices} onCustomChange={setCustomServices} customErrors={serviceValidation?.customErrors ?? []} />
        </fieldset>
      </div>

      <aside className="summary-column animate-enter delay-2">
        <div className="summary-card">
          <div className="summary-top"><span className="summary-kicker">VISTA PREVIA DE CANON</span><span className="live-indicator"><i /> EN VIVO</span></div>
          <div className="summary-caption">{terms.length > 1 ? `Canon mensual total · escenario principal (${term} meses)` : "Canon mensual total"}</div>
          <div className="grand-total mono" data-testid="text-grand-total">{currency(total)}</div>
          <div className="tax-caption">Antes de IVA <span>·</span> {term ? `${term} meses` : "Sin periodo"}</div>
          {terms.length > 1 && <div className="scenario-totals" data-testid="list-scenario-totals">{scenarios.map(s => <div key={s.termMonths} className={s.termMonths === term ? "is-primary" : ""}><span>{s.termMonths} meses{s.termMonths === term ? " · principal" : ""}</span><strong className="mono">{currency(s.total)}</strong></div>)}</div>}
          {blockingErrors.length > 0 && <div className="blocking-errors" role="status"><strong>Cálculo bloqueado</strong><ul>{blockingErrors.map(message => <li key={message}>{message}</li>)}</ul></div>}
          <div className="summary-divider" />
          <div className="quote-facts"><div><span>Cliente</span><strong data-testid="text-quote-customer">{customer.trim() || "Sin especificar"}</strong></div><div><span>Cotización ID</span><strong data-testid="text-quote-code">{quoteCode.trim() || "Sin especificar"}</strong></div><div><span>Plazos</span><strong data-testid="text-quote-terms">{terms.length ? `${terms.join(" · ")} meses` : "Sin seleccionar"}</strong></div><div><span>Entrega</span><strong data-testid="text-quote-delivery">{deliveryStatus || "Sin especificar"}</strong></div><div><span>Servicio</span><strong data-testid="text-service-scheme">{individual ? `Servicios individuales (${selectedServices.length + customServices.length})` : packageType ?? "Sin seleccionar"}</strong></div></div>
          <div className="summary-divider" />
          <div className="summary-list-head"><span>{terms.length > 1 ? `DESGLOSE · ${term} MESES` : "DESGLOSE POR REFERENCIA"}</span><span>{rows.length} {rows.length === 1 ? "activo" : "activos"}</span></div>
          <div className="summary-lines">
            {rows.map((row, index) => <div className="summary-line" key={`${index}-${row.reference}`}>
              <div className="summary-line-main"><span className="line-kind">{row.assetType}</span><strong>{row.reference.trim() || "Sin referencia"}</strong><small>{row.quantity} {row.quantity === 1 ? "unidad" : "unidades"}</small></div>
              <div className="summary-line-prices"><span className="mono">{currency(pricedRows[index]?.canonUnitarioMensual)}<small> / unidad</small></span><strong className="mono">{currency(pricedRows[index]?.canonMensualTotal)}<small> / mes</small></strong></div>
            </div>)}
          </div>
          <div className="summary-bottom"><span>{terms.length > 1 ? `Canon total mensual · ${term} meses` : "Canon total mensual"}</span><strong className="mono">{currency(total)}</strong></div>
          <div className="summary-foot"><span>Importes expresados en dólares estadounidenses.</span><ArrowUpRight size={15} /></div>
        </div>
        <div className="trust-note"><span className="trust-mark">i</span><p>Estimación comercial calculada con los parámetros vigentes. Los valores se muestran antes de impuestos.</p></div>
        {user?.role === "admin" && <Link className="admin-shortcut" href="/admin"><Settings2 size={15} /> Ajustar parámetros de precios <ArrowUpRight size={14} /></Link>}
      </aside>
    </div>
    <QuoteSummaryTable customer={customer} quoteCode={quoteCode} resolveProposalVersion={() => saveQuote(false)} term={term ?? 36} scenarios={scenarios} deliveryStatus={deliveryStatus} packageType={individual ? null : packageType} serviceMode={serviceMode} includedServices={includedServices} rows={numericRows} calculatedRows={pricedRows} total={total} errors={blockingErrors} invalidRows={validation?.rowErrors.map(issues => Object.keys(issues).length > 0) ?? []} onSave={() => { void saveQuote().catch(() => undefined); }} saving={saveMutation.isPending || versionMutation.isPending} versionNumber={editId && editSnapshot.current ? editSnapshot.current.versionNumber + 1 : 1} saveLabel={editId ? "Guardar nueva versión" : undefined} notice={editId && editSnapshot.current && preview && editSnapshot.current.configRevision !== preview.configRevision ? "Los parámetros de precios han cambiado desde la versión anterior. El canon se recalculará con los valores actuales." : undefined} saveError={saveError} />
  </main>;
}
