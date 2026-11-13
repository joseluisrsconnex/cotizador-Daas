import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { buildQuotePdf, type QuotePdfSnapshot } from "../artifacts/cotizador-daas/src/lib/quote-pdf";
import { buildQuoteWorkbook } from "../artifacts/cotizador-daas/src/lib/quote-excel";

const snapshot: QuotePdfSnapshot = {
  customer: "Export services QA", quoteCode: "EXPORT-123", term: 36, packageType: null, serviceMode: "Servicios individuales",
  rows: ["HW Seguridad", "Equipos POS", "Licenciamiento"].map(assetType => ({
    assetType: assetType as "HW Seguridad" | "Equipos POS" | "Licenciamiento", reference: `${assetType} REF`, quantity: 2, unitCost: 1000,
  })),
  calculatedRows: ["HW Seguridad", "Equipos POS", "Licenciamiento"].map(assetType => ({
    assetType: assetType as "HW Seguridad" | "Equipos POS" | "Licenciamiento", reference: `${assetType} REF`, quantity: 2,
    canonUnitarioMensual: new Decimal(10), canonMensualTotal: new Decimal(20),
    canonProducto: new Decimal(16), canonPaquetePorUnidad: new Decimal(2), residual: 0,
  })),
  total: new Decimal(60),
  includedServices: [
    { id: "catalog", name: "Soporte por perfil", unitCost: 9876.54321, unit: "Por perfil", quantity: 3 },
    { id: "custom:one", name: "=Servicio privado anual", unitCost: 12345.6789, unit: "Por año" },
  ],
};
describe("Exportación de activos nuevos y servicios incluidos", () => {
  it("el PDF lista activos, nombre/unidad/cantidad y nunca los costos individuales", () => {
    const logo = `data:image/png;base64,${readFileSync(new URL("../client/public/brand/novotechno-logo-nts.png", import.meta.url)).toString("base64")}`;
    const pdf = buildQuotePdf(snapshot, logo).output();
    for (const text of ["HW Seguridad", "Equipos POS", "Licenciamiento", "Soporte por perfil", "Por perfil", "Cantidad"])
      expect(pdf).toContain(text);
    expect(pdf).not.toContain("9876");
    expect(pdf.includes("Cotización ID")).toBe(true);
    expect(pdf).toContain(snapshot.quoteCode);
    expect(pdf).not.toContain("12345");
    expect(pdf).not.toMatch(/margin|minimum|profitable|configSnapshot/);
  });
  it("el Excel lista servicios bajo la tabla y conserva nombres como texto", async () => {
    const workbook = buildQuoteWorkbook(snapshot);
    const sheet = workbook.getWorksheet("Resumen")!;
    const values: unknown[] = [];
    sheet.eachRow(row => { row.eachCell(cell => values.push(cell.value)); });
    for (const text of ["HW Seguridad", "Equipos POS", "Licenciamiento", "Servicios incluidos", "Soporte por perfil", "Por perfil", "=Servicio privado anual"])
      expect(values).toContain(text);
    expect(values).toContain(3);
    expect(values).toContain("Cotización ID");
    expect(values).toContain(snapshot.quoteCode);
    expect(values).not.toContain(9876.54321);
    expect(values).not.toContain(12345.6789);
    expect(values.some(value => value && typeof value === "object" && "formula" in value)).toBe(false);
    expect((await workbook.xlsx.writeBuffer()).byteLength).toBeGreaterThan(1000);
  });
  it("PDF y Excel incluyen estado, comparativa y detalle de todos los plazos sin costos de garantía", () => {
    const multi: QuotePdfSnapshot = {
      ...snapshot, term: 12, deliveryStatus: "CTO",
      rows: snapshot.rows.map(row => ({ ...row, warrantyExtensions: [{ termMonths: 60, unitCost: 7654321.98765 }] })),
      scenarios: [
        { termMonths: 12, calculatedRows: snapshot.calculatedRows, total: new Decimal(60) },
        { termMonths: 60, calculatedRows: snapshot.calculatedRows.map(row => ({
          ...row, canonUnitarioMensual: new Decimal(15), canonMensualTotal: new Decimal(30),
        })), total: new Decimal(90) },
      ],
    };
    const logo = `data:image/png;base64,${readFileSync(new URL("../client/public/brand/novotechno-logo-nts.png", import.meta.url)).toString("base64")}`;
    const pdf = buildQuotePdf(multi, logo).output();
    for (const text of ["CTO", "12 meses", "60 meses", "Escenario: 12 meses", "Escenario: 60 meses"])
      expect(pdf).toContain(text);
    expect(pdf).not.toContain("7654321");
    expect(pdf).not.toMatch(/warrantyExtensions|configSnapshot|minimum|profitable/);
    const sheet = buildQuoteWorkbook(multi).getWorksheet("Resumen")!;
    const values: unknown[] = [];
    sheet.eachRow(row => row.eachCell(cell => values.push(cell.value)));
    for (const text of ["CTO", "12 meses", "60 meses", "Escenario: 12 meses", "Escenario: 60 meses"])
      expect(values).toContain(text);
    expect(values).toContain(60);
    expect(values).toContain(90);
    expect(values).not.toContain(7654321.98765);
    expect(JSON.stringify(values)).not.toMatch(/warrantyExtensions|configSnapshot|minimum|profitable/);
  });
});
