import type { AssetType, QuoteLineInput, ServicePackageType, TermMonths } from "@workspace/pricing";

/** Raw warranty extension text per term, kept even when the term is deselected. */
export type ExtensionDrafts = Partial<Record<TermMonths, string>>;
export type QuoteDraftRow = Omit<QuoteLineInput, "unitCost"> & { unitCost: string; extensions?: ExtensionDrafts };
export interface WarrantyExtensionValue { termMonths: TermMonths; unitCost: number }
export type ValidatedQuoteRow = QuoteLineInput & { warrantyExtensions?: WarrantyExtensionValue[] };
export type DeliveryChoice = "Local" | "CTO" | "";
export const ALL_TERMS: TermMonths[] = [12, 24, 36, 48, 60];

/** Selected terms in ascending order; the first one is the primary (shortest) scenario. */
export function sortTerms(terms: readonly TermMonths[]): TermMonths[] {
  return ALL_TERMS.filter(t => terms.includes(t));
}
export const shortestTerm = (terms: readonly TermMonths[]): TermMonths | undefined => sortTerms(terms)[0];
export const longerTerms = (terms: readonly TermMonths[]): TermMonths[] => sortTerms(terms).slice(1);
export const warrantyIncludedLabel = (term: TermMonths) => `Incluye garantía de ${term} meses`;
export const extensionLabel = (term: TermMonths) => `Extensión de garantía a ${term} meses (USD por unidad)`;
export const extensionMissingMessage = (term: TermMonths, reference: string) =>
  `Indique el costo de extensión de garantía a ${term} meses para ${reference}.`;
export const TERMS_REQUIRED_MESSAGE = "Seleccione al menos un periodo de la operación.";
export const DELIVERY_REQUIRED_MESSAGE = "Seleccione el estado de entrega de los activos.";
export function quoteCodeError(value: string): string | null {
  return !value.trim() ? "El Cotización ID es obligatorio." : value.length > 50 ? "El Cotización ID no puede superar 50 caracteres." : null;
}
export function changeAssetType(row: QuoteDraftRow, assetType: AssetType): QuoteDraftRow {
  return { ...row, assetType, ...(assetType === "Licenciamiento" ? { extensions: {}, warrantyExtensions: undefined } : {}) };
}
export interface RowErrors {
  assetType?: string;
  reference?: string;
  quantity?: string;
  unitCost?: string;
  /** Messages keyed by term for each missing/invalid warranty extension. */
  extensions?: Partial<Record<TermMonths, string>>;
}

/** One decimal separator, no currency symbols, grouping separators or exponents. */
export function parseDecimalInput(raw: string): number | undefined {
  const text = raw.trim();
  if (!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(text)) return undefined;
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) ? value : undefined;
}

export function warrantyMessage(term: TermMonths): string {
  return `El costo unitario debe incluir la garantía del fabricante de ${term} meses. Para los periodos más largos, indique el costo de extensión de garantía.`;
}

export function validateQuoteDraft(
  input: {
    customer: string;
    packageType: ServicePackageType | null;
    serviceMode?: ServiceModeChoice;
    rows: QuoteDraftRow[];
    /** When provided, terms (min 1) and warranty extensions for longer terms are validated. */
    terms?: readonly TermMonths[];
    /** When provided (including ""), the delivery status is required. */
    deliveryStatus?: DeliveryChoice;
  },
  catalog: { assetTypes: readonly AssetType[]; servicePackages: Array<{ packageType: ServicePackageType }> },
) {
  const errors: string[] = [];
  if (!input.customer.trim()) errors.push("El nombre del cliente es obligatorio.");
  if (input.rows.length === 0) errors.push("Añada al menos una fila completa para cotizar.");
  const packageError = input.serviceMode === "Servicios individuales" ? null : catalog.servicePackages.some(p => p.packageType === input.packageType)
    ? null : "Seleccione un paquete de servicio.";
  if (packageError) errors.push(packageError);
  const termsError = input.terms && input.terms.length === 0 ? TERMS_REQUIRED_MESSAGE : null;
  if (termsError) errors.push(termsError);
  const deliveryError = input.deliveryStatus !== undefined && input.deliveryStatus !== "Local" && input.deliveryStatus !== "CTO"
    ? DELIVERY_REQUIRED_MESSAGE : null;
  if (deliveryError) errors.push(deliveryError);
  const extensionTerms = input.terms ? longerTerms(input.terms) : [];
  const rowErrors: RowErrors[] = [];
  const rows: ValidatedQuoteRow[] = input.rows.map((row, index) => {
    const issues: RowErrors = {};
    if (!catalog.assetTypes.includes(row.assetType)) issues.assetType = "Seleccione un tipo de activo válido.";
    if (!row.reference.trim()) issues.reference = "La referencia es obligatoria.";
    if (!Number.isInteger(row.quantity) || row.quantity <= 0) issues.quantity = "Las unidades deben ser un entero mayor que cero.";
    const value = parseDecimalInput(row.unitCost);
    if (value === undefined || value <= 0) {
      issues.unitCost = "Introduzca un costo numérico mayor que cero en USD.";
    }
    const { extensions: drafts = {}, ...base } = row;
    const extensionIssues: Partial<Record<TermMonths, string>> = {};
    const warrantyExtensions: WarrantyExtensionValue[] = [];
    for (const term of row.assetType === "Licenciamiento" ? [] : extensionTerms) {
      const amount = parseDecimalInput(drafts[term] ?? "");
      if (amount === undefined || amount < 0) extensionIssues[term] = extensionMissingMessage(term, row.reference.trim() || `la fila ${index + 1}`);
      else warrantyExtensions.push({ termMonths: term, unitCost: amount });
    }
    const fieldMessages = Object.values(issues) as string[];
    if (Object.keys(extensionIssues).length) issues.extensions = extensionIssues;
    rowErrors.push(issues);
    fieldMessages.forEach(message => errors.push(`Fila ${index + 1}: ${message}`));
    Object.values(extensionIssues).forEach(message => errors.push(message as string));
    return { ...base, reference: row.reference.trim(), unitCost: value ?? NaN, ...(warrantyExtensions.length ? { warrantyExtensions } : {}) };
  });
  return { errors, rowErrors, packageError, termsError, deliveryError, rows };
}

export type ServiceModeChoice = "Paquete" | "Servicios individuales";
export type ServiceUnitChoice = "Por equipo" | "Por perfil" | "Por evento" | "Por año" | "Por equipo saliente" | "Por equipo por evento";
export const serviceUnits: ServiceUnitChoice[] = ["Por equipo", "Por perfil", "Por evento", "Por año", "Por equipo saliente", "Por equipo por evento"];
export const needsQuantity = (unit: string) => ["Por perfil", "Por evento", "Por equipo saliente"].includes(unit);

export interface SelectedServiceDraft { id: string; name?: string; quantity: string; events?: Partial<Record<TermMonths, string>> }
export function pruneServiceEvents<T extends { events?: Partial<Record<TermMonths, string>> }>(items: T[], terms: readonly TermMonths[]): T[] {
  return items.map(item => item.events && Object.keys(item.events).some(t => !terms.includes(Number(t) as TermMonths))
    ? { ...item, events: Object.fromEntries(Object.entries(item.events).filter(([t]) => terms.includes(Number(t) as TermMonths))) } : item);
}
export interface CustomServiceDraft { id: string; name: string; unitCost: string; unit: ServiceUnitChoice; quantity: string; events?: Partial<Record<TermMonths, string>> }
export interface CustomServiceErrors { name?: string; unitCost?: string; quantity?: string; events?: string }
interface CatalogService { id: string; name: string; unitCost: number; unit: string; mandatory: boolean; active: boolean }

const parseQty = (raw: string) => /^\s*\d+\s*$/.test(raw) && Number(raw) > 0 && Number.isSafeInteger(Number(raw)) ? Number(raw) : undefined;

export function validateServiceScheme(
  input: { serviceMode: ServiceModeChoice; selectedServices: SelectedServiceDraft[]; customServices: CustomServiceDraft[]; terms?: readonly TermMonths[]; physicalUnits?: number },
  catalog: { individualServices: CatalogService[] },
) {
  const errors: string[] = [];
  const selectedErrors: Record<string, string> = {};
  const customErrors: CustomServiceErrors[] = [];
  const selectedServices: Array<{ id: string; quantity?: number; events?: Array<{ termMonths: TermMonths; quantity: number }> }> = [];
  const eventValues = (draft: SelectedServiceDraft | CustomServiceDraft) => (input.terms ?? []).map(termMonths => ({
    termMonths, quantity: parseQty(draft.events?.[termMonths] ?? "") ?? NaN,
  }));
  const missingEvents = (events: ReturnType<typeof eventValues>) => events.filter(e => !Number.isSafeInteger(e.quantity))
    .map(e => `Indique el número de mantenimientos preventivos para el periodo de ${e.termMonths} meses.`);
  if (input.physicalUnits === 0) return { errors, selectedErrors, customErrors, selectedServices, customServices: [] };
  if (input.serviceMode === "Servicios individuales") {
    for (const item of input.selectedServices) {
      const service = catalog.individualServices.find(s => s.id === item.id && s.active);
      if (!service) {
        const message = `El servicio "${item.name ?? item.id}" ya no está disponible en el catálogo. Desmárquelo para continuar.`;
        selectedErrors[item.id] = message; errors.push(message); continue;
      }
      if (service.unit === "Por equipo por evento") {
        const events = eventValues(item);
        const messages = missingEvents(events);
        if (messages.length) { selectedErrors[item.id] = messages.join(" "); errors.push(...messages); }
        else selectedServices.push({ id: item.id, events });
      } else if (needsQuantity(service.unit)) {
        const quantity = parseQty(item.quantity);
        if (quantity === undefined) {
          const message = service.unit === "Por equipo saliente" ? "Indique la cantidad de equipos salientes, un entero mayor que cero." : `${service.name}: la cantidad debe ser un entero mayor que cero.`;
          selectedErrors[item.id] = message; errors.push(message);
        } else selectedServices.push({ id: item.id, quantity });
      } else selectedServices.push({ id: item.id });
    }
    for (const service of catalog.individualServices) {
      if (service.active && service.mandatory && !input.selectedServices.some(s => s.id === service.id)) {
        errors.push(`El servicio obligatorio "${service.name}" debe estar incluido.`);
      }
    }
  }
  const customServices = input.customServices.map((item, index) => {
    const issues: CustomServiceErrors = {};
    const name = item.name.trim();
    if (!name) issues.name = "El nombre del servicio es obligatorio.";
    else if (name.length > 200) issues.name = "El nombre no puede superar 200 caracteres.";
    const unitCost = parseDecimalInput(item.unitCost);
    if (unitCost === undefined || unitCost <= 0) issues.unitCost = "Introduzca un costo numérico mayor que cero en USD.";
    const quantity = needsQuantity(item.unit) ? parseQty(item.quantity) : undefined;
    if (needsQuantity(item.unit) && quantity === undefined) issues.quantity = "La cantidad debe ser un entero mayor que cero.";
    const events = item.unit === "Por equipo por evento" ? eventValues(item) : undefined;
    if (events && missingEvents(events).length) issues.events = missingEvents(events).join(" ");
    customErrors.push(issues);
    Object.values(issues).forEach(message => errors.push(`Servicio nuevo ${index + 1}: ${message}`));
    return { id: item.id, name, unitCost: unitCost ?? NaN, unit: item.unit, ...(quantity !== undefined ? { quantity } : {}), ...(events ? { events } : {}) };
  });
  return { errors, selectedErrors, customErrors, selectedServices, customServices };
}
