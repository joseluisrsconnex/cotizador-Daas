import { existsSync, readFileSync } from "node:fs";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import Decimal from "decimal.js";
import type { SavedQuote, ProposalDetails } from "@workspace/api-zod";
import { QuoteAccessError } from "./quote-storage";

const dateText = (date: Date) => new Intl.DateTimeFormat("es-CO", {
  day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
}).format(date);
const money = (amount: string) => `USD ${new Decimal(amount).toFixed(2)
  .replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
const joinTerms = (terms: number[], conjunction: string) => terms.length < 2
  ? String(terms[0]) : `${terms.slice(0, -1).join(", ")} ${conjunction} ${terms.at(-1)}`;

export function implementationBand(total: number) {
  if (total <= 50) return { tramo: "0 a 50 equipos", diasPlaneacion: 1, diasImplementacion: 8 };
  if (total <= 100) return { tramo: "51 a 100 equipos", diasPlaneacion: 2, diasImplementacion: 15 };
  if (total <= 200) return { tramo: "101 a 200 equipos", diasPlaneacion: 4, diasImplementacion: 30 };
  if (total <= 300) return { tramo: "201 a 300 equipos", diasPlaneacion: 5, diasImplementacion: 45 };
  if (total <= 500) return { tramo: "301 a 500 equipos", diasPlaneacion: 5, diasImplementacion: 60 };
  return { tramo: "Más de 500 equipos", diasPlaneacion: 5, diasImplementacion: 90 };
}

/** Explicit allowlist of customer-facing data; never calculate or expose internal pricing. */
export function buildProposalData(version: SavedQuote, details: ProposalDetails, now = new Date()) {
  if (version.deliveryStatus !== "Local" && version.deliveryStatus !== "CTO")
    throw new QuoteAccessError(422, "Esta versión histórica no tiene estado de entrega. Cree una nueva versión con Local o CTO para generar la propuesta.");
  const generation = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const expiry = new Date(generation);
  expiry.setUTCDate(expiry.getUTCDate() + 15);
  const totalEquipos = version.rows.reduce((sum, row) => sum + (row.assetType === "Licenciamiento" ? 0 : row.quantity), 0);
  const scenarios = [...version.scenarios].sort((a, b) => a.termMonths - b.termMonths);
  const terms = scenarios.map(s => s.termMonths);
  const names = version.includedServices.map(s => s.name);
  const has = (...services: string[]) => services.some(service => names.some(name =>
    name.toLocaleLowerCase("es").includes(service.toLocaleLowerCase("es"))));
  const packageMode = version.serviceMode === "Paquete";
  const enhanced = packageMode && (version.packageType === "Intermedio" || version.packageType === "Premium");
  const included = (value: boolean) => value ? "Incluido" : "No incluido";
  return {
    fechaPropuesta: dateText(generation), fechaVigencia: dateText(expiry),
    destinatario: details.destinatario, razonSocial: details.razonSocial, sedes: details.sedes,
    cliente: version.customer, totalEquipos,
    marcaModelo: version.rows.filter(row => !["Licenciamiento", "Accesorios"].includes(row.assetType)).map(row => row.reference).join(", "),
    lineaBase: version.rows.map(row => ({ tipo: row.assetType, referencia: row.reference, cantidad: row.quantity })),
    alcAlistamiento: included(enhanced || (!packageMode && has("Creación de imagen", "Clonación", "BIOS", "Adición de hardware"))),
    alcInstalacion: included(enhanced || (!packageMode && has("Entrega de equipo y firma de acta"))),
    alcMigracion: included((packageMode && version.packageType === "Premium") || (!packageMode && has("Migración de información"))),
    alcLogistica: "Incluido", alcMesaAyuda: "Incluido", alcSpare: "Incluido",
    ...implementationBand(totalEquipos),
    estadoEntrega: version.deliveryStatus,
    plazoEntrega: version.deliveryStatus === "Local" ? "8 días calendario" : "60 días calendario",
    plazosTexto: joinTerms(terms, "y"), plazosTextoO: joinTerms(terms, "o"),
    escenarios: scenarios.map((scenario, index) => ({
      numero: index + 1, duracion: scenario.termMonths,
      filas: scenario.results.map(row => ({
        tipo: row.assetType, referencia: row.reference, cantidad: row.quantity,
        canonUnitario: money(row.canonUnitarioMensual), canonTotal: money(row.canonMensualTotal),
      })),
      totalEscenario: money(scenario.totalMonthlyBeforeTax),
    })),
  };
}

export function renderProposalDocx(data: ReturnType<typeof buildProposalData>): Buffer {
  const contactEmail = (key: string): string => {
    const value = process.env[key]?.trim();
    if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      throw new Error(`${key} debe configurar un correo de contacto válido para generar propuestas.`);
    return value;
  };
  // The build copies the exact template next to the bundled server; source tests use the repository file.
  const bundled = new URL("./templates/propuesta-daas.docx", import.meta.url);
  const template = existsSync(bundled) ? bundled : new URL("../../../../server/templates/propuesta-daas.docx", import.meta.url);
  const doc = new Docxtemplater(new PizZip(readFileSync(template)), {
    paragraphLoop: true, linebreaks: true,
    nullGetter: () => { throw new Error("Falta un dato de la plantilla de propuesta."); },
  });
  const contacts = {
    correoContacto1: contactEmail("PROPOSAL_TEMPLATE_EMAIL_1"),
    correoContacto2: contactEmail("PROPOSAL_TEMPLATE_EMAIL_2"),
  };
  doc.render({ ...data, ...contacts });
  // SmartArt keeps both its data model and its cached drawing outside document.xml.
  // Replace in both parts so Word and other viewers show the same client name.
  const xmlText = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  // Hyperlink targets live in relationships, outside Docxtemplater's text
  // replacement. Keep mailto targets consistent with the visible contact.
  for (const part of doc.getZip().file(/^word\/_rels\/.*\.rels$/)) {
    let xml = part.asText();
    for (const [tag, email] of Object.entries(contacts))
      xml = xml.replaceAll(`{${tag}}`, xmlText(email));
    doc.getZip().file(part.name, xml);
  }
  for (const part of doc.getZip().file(/^word\/diagrams\/.*\.xml$/)) {
    const xml = part.asText();
    if (xml.includes("{cliente}")) doc.getZip().file(part.name, xml.replaceAll("{cliente}", xmlText(data.cliente)));
  }
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
}

export function proposalFilename(customer: string, version: number, now: Date) {
  const safe = customer.replace(/[^\p{L}\p{N} _.-]/gu, "_").replace(/["\\\r\n]/g, "_").slice(0, 120);
  // ASCII fallback in Content-Disposition; UTF-8 name is supplied separately by the route.
  return `Propuesta_DaaS_${safe}_v${version}_${now.toISOString().slice(0, 10)}.docx`;
}
