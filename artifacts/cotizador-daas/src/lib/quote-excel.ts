import ExcelJS from "exceljs";
import type { QuotePdfSnapshot } from "./quote-pdf";
import { exportScenarios } from "./quote-pdf";
import { warrantyMessage } from "./quote-validation";
import { BRAND } from "./brand";

export function buildQuoteWorkbook(quote: QuotePdfSnapshot) {
  const scenarios = exportScenarios(quote);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = BRAND.name;
  const sheet = workbook.addWorksheet("Resumen", { views: [{ state: "frozen", ySplit: 9 }] });
  sheet.columns = [{ width: 23 }, { width: 38 }, { width: 14 }, { width: 30 }, { width: 30 }];
  sheet.addRow([BRAND.applicationName]);
  sheet.mergeCells("A1:E1");
  sheet.getCell("A1").font = { bold: true, size: 18, color: { argb: "FF6D31FA" } };
  sheet.addRow(["Cliente", quote.customer]);
  sheet.addRow(["Cotización ID", quote.quoteCode]);
  sheet.addRow(["Fecha", `${quote.createdAt ? new Date(quote.createdAt).toLocaleString("es-ES") : new Date().toLocaleString("es-ES")}${quote.versionNumber ? ` · Versión ${quote.versionNumber}` : ""}`]);
  sheet.addRow(["Periodos", scenarios.map(scenario => `${scenario.termMonths} meses`).join(", ")]);
  sheet.addRow(["Esquema de servicios", quote.serviceMode === "Servicios individuales" ? quote.serviceMode : quote.packageType]);
  sheet.addRow(["Estado de entrega", quote.deliveryStatus || "Sin especificar"]);
  sheet.addRow([]);
  sheet.addRow([warrantyMessage(quote.term)]);
  sheet.mergeCells("A9:E9");
  sheet.getRow(9).height = 44;
  sheet.getCell("A9").alignment = { wrapText: true, vertical: "middle" };
  sheet.getCell("A9").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF9ED" } };
  sheet.getCell("A9").font = { color: { argb: "FF79592D" } };
  sheet.addRow([]);
  const comparisonHead = sheet.addRow(["Comparativa de totales por periodo", "Canon mensual total USD antes de IVA"]);
  comparisonHead.font = { bold: true, color: { argb: "FF6D31FA" } };
  for (const scenario of scenarios) {
    const row = sheet.addRow([`${scenario.termMonths} meses`, scenario.total.toNumber()]);
    row.getCell(2).numFmt = '"USD" #,##0.00';
  }
  for (const scenario of scenarios) {
  sheet.addRow([]);
  const title = sheet.addRow([`Escenario: ${scenario.termMonths} meses`]);
  title.font = { bold: true, color: { argb: "FF6D31FA" } };
  const header = sheet.addRow(["Tipo de producto", "Referencia", "Cantidad",
    "Canon unitario mensual USD antes de IVA", "Canon mensual total USD antes de IVA"]);
  header.height = 42;
  header.eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6D31FA" } };
    cell.alignment = { wrapText: true, vertical: "middle" };
  });
  quote.rows.forEach((row, index) => {
    // Plain strings stay strings (including leading "="), never spreadsheet formulas.
    const line = sheet.addRow([row.assetType, row.reference, row.quantity,
      scenario.calculatedRows[index].canonUnitarioMensual.toNumber(),
      scenario.calculatedRows[index].canonMensualTotal.toNumber()]);
    [4, 5].forEach(column => { line.getCell(column).numFmt = '"USD" #,##0.00'; });
    line.getCell(2).alignment = { wrapText: true };
  });
  const footer = sheet.addRow(["Total mensual antes de IVA", "", "", "", scenario.total.toNumber()]);
  sheet.mergeCells(footer.number, 1, footer.number, 4);
  footer.getCell(5).numFmt = '"USD" #,##0.00';
  footer.eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FF231C35" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1EAFE" } };
  });
  }
  if (quote.includedServices?.length) {
    sheet.addRow([]);
    const servicesHeader = sheet.addRow(["Servicios incluidos", "Unidad de medida", "Cantidad"]);
    servicesHeader.font = { bold: true, color: { argb: "FF6D31FA" } };
    for (const service of quote.includedServices) {
      const row = sheet.addRow([service.name, service.unit, service.quantity ?? ""]);
      row.getCell(1).alignment = { wrapText: true, vertical: "top" };
    }
  }
  sheet.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return workbook;
}

export async function downloadQuoteExcel(quote: QuotePdfSnapshot) {
  const buffer = await buildQuoteWorkbook(quote).xlsx.writeBuffer();
  const blob = new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `cotizacion-novotechno-${quote.term}-meses${quote.versionNumber ? `-v${quote.versionNumber}` : ""}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
