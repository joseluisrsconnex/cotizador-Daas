import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { CalculatedQuoteLine, ExactAmount, QuoteLineInput, ServicePackageType, TermMonths, ServiceMode, CustomQuoteService } from "@workspace/pricing";
import { formatUsd } from "./format";
import { warrantyMessage } from "./quote-validation";
import { BRAND } from "./brand";

export interface QuotePdfSnapshot {
  customer: string;
  quoteCode: string;
  term: TermMonths;
  packageType: ServicePackageType | null;
  serviceMode?: ServiceMode;
  includedServices?: CustomQuoteService[];
  rows: QuoteLineInput[];
  calculatedRows: CalculatedQuoteLine[];
  total: ExactAmount;
  createdAt?: string;
  versionNumber?: number;
  deliveryStatus?: "Local" | "CTO" | "";
  scenarios?: Array<{ termMonths: TermMonths; calculatedRows: CalculatedQuoteLine[]; total: ExactAmount }>;
}

export function exportScenarios(quote: QuotePdfSnapshot) {
  return quote.scenarios?.length ? quote.scenarios : [{ termMonths: quote.term, calculatedRows: quote.calculatedRows, total: quote.total }];
}

export function buildQuotePdf(quote: QuotePdfSnapshot, logoDataUrl: string) {
  const scenarios = exportScenarios(quote);
  const doc = new jsPDF();
  doc.setProperties({ title: BRAND.applicationName, subject: "Cotización en USD antes de IVA", creator: BRAND.name });
  // The supplied lockup has white lettering; keep it legible on the PDF's white page.
  doc.setFillColor(29, 24, 48);
  doc.roundedRect(14, 11, 45, 14, 2, 2, "F");
  doc.addImage(logoDataUrl, "PNG", 15, 12, 43, 43 * 470 / 1842);
  doc.setTextColor(109, 49, 250);
  doc.setFontSize(18);
  doc.text(BRAND.name, 64, 19);
  doc.setTextColor(35, 28, 53);
  doc.setFontSize(10);
  doc.text("Cotizador DaaS · Importes en USD antes de IVA", 64, 26);
  doc.setFontSize(14);
  doc.text("Valor de Canon x periodo", 14, 38);
  let endY = 45;
  autoTable(doc, {
    startY: endY, theme: "plain",
    body: [["Cliente", quote.customer.trim()],
      ["Cotización ID", quote.quoteCode],
      ["Fecha", `${new Date(quote.createdAt ?? Date.now()).toLocaleString("es-ES")} · Versión ${quote.versionNumber ?? 1}`],
      ["Periodos", scenarios.map(scenario => `${scenario.termMonths} meses`).join(", ")],
      ["Estado de entrega", quote.deliveryStatus || "Sin especificar"],
      ["Esquema de servicios", quote.serviceMode === "Servicios individuales" ? quote.serviceMode : quote.packageType ?? "Sin seleccionar"]],
    styles: { fontSize: 10, textColor: [35, 28, 53] },
    columnStyles: { 0: { cellWidth: 35, fontStyle: "bold" } },
    didDrawPage: data => { endY = data.cursor?.y ?? endY; },
  });
  autoTable(doc, {
    startY: endY + 5, theme: "grid", body: [[warrantyMessage(quote.term)]],
    styles: { fontSize: 9, fillColor: [255, 249, 237], textColor: [121, 89, 45], lineColor: [180, 138, 59], cellPadding: 4 },
    didDrawPage: data => { endY = data.cursor?.y ?? endY; },
  });
  autoTable(doc, {
    startY: endY + 6,
    head: [["Periodo", "Canon mensual total USD antes de IVA"]],
    body: scenarios.map(scenario => [`${scenario.termMonths} meses`, formatUsd(scenario.total)]),
    theme: "grid", margin: { top: 18, bottom: 20 },
    styles: { fontSize: 10, textColor: [35, 28, 53] },
    headStyles: { fillColor: [109, 49, 250] },
    didDrawPage: data => { endY = data.cursor?.y ?? endY; },
  });
  for (const scenario of scenarios) {
    if (endY > 235) { doc.addPage(); endY = 18; }
    doc.setFontSize(12);
    doc.setTextColor(35, 28, 53);
    doc.text(`Escenario: ${scenario.termMonths} meses`, 14, endY + 9);
    autoTable(doc, {
    startY: endY + 13,
    head: [["Tipo de producto", "Referencia", "Cantidad", "Canon unitario mensual USD antes de IVA", "Canon mensual total USD antes de IVA"]],
    body: quote.rows.map((row, index) => [row.assetType, row.reference, row.quantity,
      formatUsd(scenario.calculatedRows[index].canonUnitarioMensual),
      formatUsd(scenario.calculatedRows[index].canonMensualTotal)]),
    foot: [[{ content: "Total mensual antes de IVA", colSpan: 4 }, formatUsd(scenario.total)]],
    showFoot: "lastPage",
    theme: "grid", margin: { top: 18, bottom: 20, left: 14, right: 14 },
    styles: { fontSize: 9, cellPadding: 3, textColor: [35, 28, 53], overflow: "linebreak" },
    headStyles: { fillColor: [109, 49, 250], textColor: [255, 255, 255] },
    footStyles: { fillColor: [241, 234, 254], textColor: [35, 28, 53] },
    columnStyles: { 0: { cellWidth: 29 }, 1: { cellWidth: 42 }, 2: { cellWidth: 18, halign: "right" },
      3: { cellWidth: 45, halign: "right" }, 4: { cellWidth: 48, halign: "right" } },
    didDrawPage: data => { endY = data.cursor?.y ?? endY; },
  });
  }
  if (quote.includedServices?.length) {
    // Explicit allowlist: client PDFs must never include individual service costs.
    autoTable(doc, {
      startY: endY + 6, theme: "grid", margin: { top: 18, bottom: 20 },
      head: [["Servicios incluidos", "Unidad de medida", "Cantidad"]],
      body: quote.includedServices.map(service => [service.name, service.unit, service.quantity ?? "—"]),
      styles: { fontSize: 9, overflow: "linebreak", textColor: [35, 28, 53] },
      headStyles: { fillColor: [109, 49, 250] },
    });
  }
  for (let page = 1; page <= doc.getNumberOfPages(); page++) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(89, 82, 103);
    doc.text(`${BRAND.name} · USD · Antes de IVA`, 14, 286);
    doc.text(`${page} / ${doc.getNumberOfPages()}`, 196, 286, { align: "right" });
  }
  return doc;
}

export async function downloadQuotePdf(quote: QuotePdfSnapshot) {
  const response = await fetch(BRAND.logo);
  if (!response.ok) throw new Error("No se pudo cargar el logo para el PDF.");
  const blob = await response.blob();
  const logo = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("No se pudo leer el logo."));
    reader.readAsDataURL(blob);
  });
  buildQuotePdf(quote, logo).save(`cotizacion-novotechno-${quote.term}-meses${quote.versionNumber ? `-v${quote.versionNumber}` : ""}.pdf`);
}
