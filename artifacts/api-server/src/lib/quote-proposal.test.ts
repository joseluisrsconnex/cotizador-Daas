import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { GetQuoteVersionResponse, type SavedQuote, type ProposalDetails } from "@workspace/api-zod";
import { buildProposalData, implementationBand, proposalFilename, renderProposalDocx } from "./quote-proposal";

const now = new Date("2026-11-10T12:00:00Z");
const details: ProposalDetails = { destinatario: "Persona de prueba", razonSocial: "Empresa de prueba", sedes: "Bogotá y Medellín" };
const physical = { assetType: "Laptop", reference: "REFERENCIA-PORTATIL", quantity: 95, unitCost: 9876.54 };
const license = { assetType: "Licenciamiento", reference: "REFERENCIA-LICENCIA", quantity: 300, unitCost: 8765.43 };
const amounts = [
  { termMonths: 60, unit: "10.123456", line: "961.72832", licenseLine: "3036", total: "3997.72832" },
  { termMonths: 12, unit: "30.123456", line: "2861.72832", licenseLine: "9036", total: "11897.72832" },
  { termMonths: 36, unit: "20.123456", line: "1911.72832", licenseLine: "6036", total: "7947.72832" },
];
const results = (entry: typeof amounts[number]) => [physical, license].map((row, i) => ({
  ...row, canonUnitarioMensual: entry.unit, canonMensualTotal: i ? entry.licenseLine : entry.line,
  canonProducto: "5555.1111", canonPaquetePorUnidad: "4444.2222", residual: 0.2,
}));
function fixture(): SavedQuote {
  return GetQuoteVersionResponse.parse({
    id: "11111111-1111-4111-8111-111111111111", ownerId: "test", customer: "Cliente & prueba", quoteCode: "DOC-TEST",
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
    currentVersionId: "22222222-2222-4222-8222-222222222222", versionId: "22222222-2222-4222-8222-222222222222",
    versionNumber: 3, createdBy: "test", createdByName: "Prueba", configRevision: "test",
    termMonths: 12, packageType: "Intermedio", serviceMode: "Paquete",
    selectedServices: [], customServices: [], includedServices: [], terms: [60, 12, 36], deliveryStatus: "CTO",
    rows: [physical, license], results: results(amounts[1]), totalMonthlyBeforeTax: amounts[1].total,
    scenarios: amounts.map(entry => ({ termMonths: entry.termMonths, results: results(entry), totalMonthlyBeforeTax: entry.total })),
  });
}
function text(buffer: Buffer) {
  return new Docxtemplater(new PizZip(buffer)).getFullText();
}

describe("Propuesta Word desde plantilla original y resultados guardados", () => {
  it("obtiene los contactos de entorno sin dejar correos fijos ni etiquetas pendientes", () => {
    vi.stubEnv("PROPOSAL_TEMPLATE_EMAIL_1", "first@example.com");
    vi.stubEnv("PROPOSAL_TEMPLATE_EMAIL_2", "second@example.com");
    try {
      const buffer = renderProposalDocx(buildProposalData(fixture(), details, now));
      const output = text(buffer);
      expect(output).toContain("first@example.com");
      expect(output).toContain("second@example.com");
      expect(output).not.toContain("{correoContacto");
      const links = new PizZip(buffer).file(/^word\/_rels\/.*\.rels$/).map(part => part.asText()).join("");
      expect(links).not.toContain("{correoContacto");
      expect(links).toMatch(/mailto:(first|second)@example\.com/);
    } finally { vi.unstubAllEnvs(); }
  });
  it("informa de la configuración ausente antes de generar un documento incompleto", () => {
    vi.stubEnv("PROPOSAL_TEMPLATE_EMAIL_1", "");
    try {
      expect(() => renderProposalDocx(buildProposalData(fixture(), details, now)))
        .toThrow("PROPOSAL_TEMPLATE_EMAIL_1");
    } finally { vi.unstubAllEnvs(); }
  });
  it("genera tres bloques ordenados con totales exactos, licencias y sin etiquetas pendientes ni importes internos", () => {
    const digest = () => createHash("sha256").update(readFileSync(new URL("../../../../server/templates/propuesta-daas.docx", import.meta.url))).digest("hex");
    const original = digest();
    const version = fixture();
    const data = buildProposalData(version, details, now);
    expect(data.escenarios.map(s => s.duracion)).toEqual([12, 36, 60]);
    expect(data.escenarios.map(s => s.totalEscenario)).toEqual(["USD 11.897,73", "USD 7.947,73", "USD 3.997,73"]);
    expect(data.plazosTexto).toBe("12, 36 y 60");
    expect(data.plazosTextoO).toBe("12, 36 o 60");
    const output = text(renderProposalDocx(data));
    for (const [index, scenario] of data.escenarios.entries()) {
      expect(output).toContain(`ESCENARIO ${index + 1}`);
      expect(output).toContain(scenario.totalEscenario);
    }
    expect(output.match(/ESCENARIO \d/g)).toHaveLength(3);
    expect(output).toContain("REFERENCIA-LICENCIA");
    expect(output).not.toMatch(/[{}]/);
    for (const privateAmount of ["9876", "8765", "5555", "4444", "9.876", "8.765", "5.555", "4.444"])
      expect(output).not.toContain(privateAmount);
    expect(digest()).toBe(original);
  });

  it("95 equipos usa el tramo 51 a 100, sin contar licencias, que sí aparecen en línea base y escenarios", () => {
    const data = buildProposalData(fixture(), details, now);
    expect(data).toMatchObject({ totalEquipos: 95, tramo: "51 a 100 equipos", diasPlaneacion: 2, diasImplementacion: 15 });
    expect(data.lineaBase).toHaveLength(2);
    expect(data.lineaBase[1]).toEqual({ tipo: "Licenciamiento", referencia: "REFERENCIA-LICENCIA", cantidad: 300 });
    expect(data.escenarios.every(s => s.filas[1].tipo === "Licenciamiento")).toBe(true);
    expect(data.marcaModelo).toBe("REFERENCIA-PORTATIL");
    const output = text(renderProposalDocx(data));
    expect(output).toContain("51 a 100 equipos");
    expect(output).toContain("2 días de planeación, 15 días de implementación");
  });

  it.each([["CTO", "60 días calendario"], ["Local", "8 días calendario"]] as const)("entrega %s usa %s", (deliveryStatus, plazoEntrega) => {
    const data = buildProposalData({ ...fixture(), deliveryStatus }, details, now);
    expect(data.plazoEntrega).toBe(plazoEntrega);
    expect(text(renderProposalDocx(data))).toContain(`Plazo de entrega correspondiente: ${plazoEntrega}`);
  });

  it.each([
    ["2026-11-10T12:00:00Z", "10 de noviembre de 2026", "25 de noviembre de 2026"],
    ["2026-12-25T23:30:00Z", "25 de diciembre de 2026", "9 de enero de 2027"],
    ["2028-02-20T00:00:00Z", "20 de febrero de 2028", "6 de marzo de 2028"],
  ])("vigencia fija de 15 días desde %s", (date, start, end) => {
    const data = buildProposalData(fixture(), details, new Date(date));
    expect(data.fechaPropuesta).toBe(start);
    expect(data.fechaVigencia).toBe(end);
    expect(text(renderProposalDocx(data))).toContain(end);
  });

  it.each([[0, 1, 8], [50, 1, 8], [51, 2, 15], [100, 2, 15], [101, 4, 30], [200, 4, 30],
    [201, 5, 45], [300, 5, 45], [301, 5, 60], [500, 5, 60], [501, 5, 90]])("tramo de %i unidades", (units, planning, implementation) => {
    expect(implementationBand(units)).toMatchObject({ diasPlaneacion: planning, diasImplementacion: implementation });
  });

  it("no infiere un estado de entrega para versiones históricas", () => {
    expect(() => buildProposalData({ ...fixture(), deliveryStatus: "" }, details, now)).toThrow("no tiene estado de entrega");
  });

  it("distingue paquete Básico, Intermedio y Premium", () => {
    for (const packageType of ["Básico", "Intermedio", "Premium"] as const) {
      const data = buildProposalData({ ...fixture(), packageType }, details, now);
      expect(data.alcAlistamiento).toBe(packageType === "Básico" ? "No incluido" : "Incluido");
      expect(data.alcInstalacion).toBe(packageType === "Básico" ? "No incluido" : "Incluido");
      expect(data.alcMigracion).toBe(packageType === "Premium" ? "Incluido" : "No incluido");
      expect([data.alcLogistica, data.alcMesaAyuda, data.alcSpare]).toEqual(["Incluido", "Incluido", "Incluido"]);
    }
  });

  it("identifica los servicios individuales contratados sin depender del catálogo actual", () => {
    const version = { ...fixture(), serviceMode: "Servicios individuales" as const, packageType: null };
    for (const name of ["Creación de imagen", "Clonación", "BIOS", "Adición de hardware"]) {
      const data = buildProposalData({ ...version, includedServices: [{ id: "test", name, unitCost: 1, unit: "Por equipo" }] }, details, now);
      expect(data.alcAlistamiento).toBe("Incluido");
      expect(data.alcInstalacion).toBe("No incluido");
    }
    const data = buildProposalData({ ...version, includedServices: [
      { id: "delivery", name: "Entrega de equipo y firma de acta", unitCost: 1, unit: "Por equipo" },
      { id: "migration", name: "Migración de información", unitCost: 1, unit: "Por equipo" },
    ] }, details, now);
    expect(data.alcInstalacion).toBe("Incluido");
    expect(data.alcMigracion).toBe("Incluido");
    expect(data.alcAlistamiento).toBe("No incluido");
  });

  it("rellena cliente en carta y ambos XML del organigrama, sin etiquetas ni Forecast interno", () => {
    const data = buildProposalData(fixture(), details, now);
    const zip = new PizZip(renderProposalDocx(data));
    const document = zip.file("word/document.xml")!.asText();
    expect(document).toContain("Cliente &amp; prueba");
    for (const name of ["word/diagrams/data1.xml", "word/diagrams/drawing1.xml"]) {
      const xml = zip.file(name)!.asText();
      expect(xml).toContain("Cliente &amp; prueba");
      expect(xml).not.toContain("{cliente}");
    }
    const textNodes = zip.file(/^word\/.*\.xml$/).flatMap(part =>
      [...part.asText().matchAll(/<(?:w|a):t(?:\s[^>]*)?>([\s\S]*?)<\/(?:w|a):t>/g)].map(match => match[1])).join("");
    expect(textNodes).not.toMatch(/[{}]/);
    expect(textNodes).not.toContain("Forecast");
  });

  it("excluye accesorios de marca/modelo pero los cuenta como unidades; un plazo no lleva conjunción", () => {
    const version = fixture();
    const data = buildProposalData({ ...version, scenarios: [version.scenarios[0]], rows: [
      ...version.rows, { ...version.rows[0], assetType: "Accesorios", reference: "MOUSE", quantity: 5 },
    ] }, details, now);
    expect(data.totalEquipos).toBe(100);
    expect(data.marcaModelo).toBe("REFERENCIA-PORTATIL");
    expect(data.plazosTexto).toBe("60");
    expect(data.plazosTextoO).toBe("60");
    expect(proposalFilename("Cliente/prueba", 4, now)).toBe("Propuesta_DaaS_Cliente_prueba_v4_2026-11-10.docx");
  });
});
