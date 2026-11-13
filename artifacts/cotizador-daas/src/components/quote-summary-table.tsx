import type {
  CalculatedQuoteLine,
  ExactAmount,
  QuoteLineInput,
  ServicePackageType,
  TermMonths,
  ServiceMode,
  CustomQuoteService,
} from "@workspace/pricing";
import { formatUsd } from "@/lib/format";
import BrandLogo from "@/components/brand-logo";
import WarrantyNotice from "@/components/warranty-notice";
import { useState } from "react";
import { ScenarioComparisonTable, ScenarioTabs, type QuoteScenarioView } from "@/components/scenario-comparison";
import { Download, Save, Sheet } from "lucide-react";
import type { SavedQuote, ProposalDetails } from "@workspace/api-client-react";
import ProposalWordDialog from "@/components/proposal-word-dialog";
import ForecastCard from "@/components/forecast-card";

interface QuoteSummaryTableProps {
  customer: string;
  quoteCode?: string;
  proposalVersion?: SavedQuote;
  resolveProposalVersion?: () => Promise<SavedQuote>;
  term: TermMonths;
  packageType: ServicePackageType | null;
  serviceMode?: ServiceMode;
  includedServices?: CustomQuoteService[];
  rows: QuoteLineInput[];
  calculatedRows: Array<CalculatedQuoteLine | undefined>;
  total: ExactAmount | undefined;
  errors: string[];
  invalidRows: boolean[];
  createdAt?: string;
  versionNumber?: number;
  saveLabel?: string;
  notice?: string;
  onSave?: () => void;
  saving?: boolean;
  saveError?: string;
  scenarios?: Array<{ termMonths: TermMonths; calculatedRows: Array<CalculatedQuoteLine | undefined>; total: ExactAmount | undefined }>;
  deliveryStatus?: "Local" | "CTO" | "";
}

export default function QuoteSummaryTable({
  customer,
  quoteCode = "",
  proposalVersion,
  resolveProposalVersion,
  term,
  packageType,
  serviceMode = "Paquete",
  includedServices = [],
  rows,
  calculatedRows,
  total,
  errors,
  invalidRows,
  createdAt,
  versionNumber,
  saveLabel,
  notice,
  onSave,
  saving = false,
  saveError,
  scenarios: scenarioProp,
  deliveryStatus,
}: QuoteSummaryTableProps) {
  const scenarios: QuoteScenarioView[] = scenarioProp?.length ? scenarioProp : [{ termMonths: term, calculatedRows, total }];
  const primaryTerm = scenarios[0].termMonths;
  const forecastScenario = [...scenarios].sort((a, b) => a.termMonths - b.termMonths)[0];
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);
  const [exportError, setExportError] = useState("");
  const [wordOpen, setWordOpen] = useState(false);
  const [lastProposal, setLastProposal] = useState<ProposalDetails | undefined>();
  const canExport = errors.length === 0 && total !== undefined && (packageType !== null || serviceMode === "Servicios individuales")
    && rows.length > 0 && calculatedRows.length === rows.length && calculatedRows.every(Boolean)
    && scenarios.every(s => s.total !== undefined && s.calculatedRows.length === rows.length && s.calculatedRows.every(Boolean));
  const exportQuote = async (format: "pdf" | "excel") => {
    if (!canExport || total === undefined || exporting) return;
    setExporting(format);
    setExportError("");
    try {
      const snapshot = {
        customer, quoteCode, term, packageType, serviceMode, includedServices, rows, total, createdAt, versionNumber,
        calculatedRows: calculatedRows.filter((row): row is CalculatedQuoteLine => row !== undefined),
        deliveryStatus: deliveryStatus ?? "",
        // Only client-facing amounts: no warranty extension costs or pricing parameters.
        scenarios: scenarios.map(s => ({
          termMonths: s.termMonths,
          calculatedRows: s.calculatedRows.filter((row): row is CalculatedQuoteLine => row !== undefined),
          total: s.total as ExactAmount,
        })),
      };
      if (format === "pdf") {
        const { downloadQuotePdf } = await import("@/lib/quote-pdf");
        await downloadQuotePdf(snapshot);
      } else {
        const { downloadQuoteExcel } = await import("@/lib/quote-excel");
        await downloadQuoteExcel(snapshot);
      }
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "No se pudo exportar el archivo. Inténtelo de nuevo.");
    } finally {
      setExporting(null);
    }
  };
  return (
    <section className="panel quote-output" aria-labelledby="quote-summary-title">
      <div className="section-heading quote-summary-heading">
        {!createdAt && <div className="section-number">04</div>}
        <div>
          <h2 id="quote-summary-title">Valor de Canon x periodo</h2>
          <p>Resumen por referencia, en el orden de la cotización.</p>
        </div>
        <div className="summary-brand"><BrandLogo /></div>
      </div>
      <WarrantyNotice term={primaryTerm} />
      {notice && <div className="quote-validation" role="status" data-testid="warning-config-changed">{notice}</div>}
      {createdAt && <p className="cost-format-note">Versión {versionNumber} · Guardada el {new Date(createdAt).toLocaleString("es-ES")} · Resultados guardados de esta versión.</p>}
      {!customer.trim() ? (
        <div className="quote-validation" role="status">
          El nombre del cliente es obligatorio. Complételo para mostrar el resumen de cotización.
        </div>
      ) : (
        <>
          <div className="output-facts">
            <div><span>Cliente</span><strong>{customer.trim()}</strong></div>
            <div><span>Cotización ID</span><strong>{quoteCode || "—"}</strong></div>
            <div><span>{scenarios.length > 1 ? "Periodos" : "Periodo"}</span><strong data-testid="text-output-terms">{scenarios.map(s => s.termMonths).join(" · ")} meses</strong></div>
            <div><span>Estado de entrega</span><strong data-testid="text-delivery-status">{deliveryStatus || "Sin especificar"}</strong></div>
            <div><span>Esquema de servicios</span><strong>{serviceMode === "Servicios individuales" ? serviceMode : packageType ?? "Sin seleccionar"}</strong></div>
          </div>
          <ScenarioComparisonTable rows={rows} scenarios={scenarios} invalidRows={invalidRows} />
          <ScenarioTabs rows={rows} scenarios={scenarios} invalidRows={invalidRows} />
          {includedServices.length > 0 && <section className="included-services" aria-label="Servicios incluidos" data-testid="included-services">
            <h3>Servicios incluidos</h3>
            <ul>{includedServices.map(service => <li key={service.id}>
              <strong>{service.name}</strong> · {service.unit}{service.quantity !== undefined ? ` · Cantidad: ${service.quantity}` : ""}
              {service.events?.map(e => ` · ${e.termMonths} meses: ${e.quantity} eventos`).join("")}
            </li>)}</ul>
          </section>}
          {errors.length > 0 && <div className="blocking-errors" role="status"><strong>Corrija los datos para calcular y exportar.</strong><ul>{errors.map(message => <li key={message}>{message}</li>)}</ul></div>}
        </>
      )}
      <ForecastCard amount={forecastScenario.total} term={forecastScenario.termMonths} />
      <div className="quote-export">
        <span>{canExport ? "Cotización válida · Todos los importes en USD antes de IVA." : "Guardar, PDF y Excel se habilitan al completar una cotización válida."}</span>
        <div className="quote-actions">
          {onSave && <button className="button primary" data-testid="button-save-quote" disabled={!canExport || saving} onClick={onSave}><Save size={15} />{saving ? "Guardando…" : saveLabel ?? "Guardar cotización"}</button>}
          <button className="button secondary" data-testid="button-export-excel" disabled={!canExport || Boolean(exporting)} aria-busy={exporting === "excel"} onClick={() => void exportQuote("excel")}><Sheet size={15} />{exporting === "excel" ? "Generando Excel…" : "Excel"}</button>
          <button className="button primary pdf-button" data-testid="button-export-pdf" disabled={!canExport || Boolean(exporting)} aria-busy={exporting === "pdf"} onClick={() => void exportQuote("pdf")}><Download size={15} />{exporting === "pdf" ? "Generando PDF…" : "Exportar PDF"}</button>
          <button className="button secondary" data-testid="button-proposal-word" disabled={!canExport || saving || Boolean(exporting) || (!proposalVersion && !resolveProposalVersion)} onClick={() => setWordOpen(true)}><Download size={15} />Propuesta Word</button>
        </div>
      </div>
      {exportError && <p className="field-error" role="alert">{exportError}</p>}
      {saveError && <p className="field-error" role="alert">{saveError}</p>}
      {wordOpen && <ProposalWordDialog customer={customer} version={proposalVersion} resolveVersion={resolveProposalVersion} initialDetails={lastProposal} onGenerated={setLastProposal} onClose={() => setWordOpen(false)} />}
    </section>
  );
}
