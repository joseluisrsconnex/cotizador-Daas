import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { changeAssetType, quoteCodeError, parseDecimalInput, pruneServiceEvents, validateQuoteDraft, validateServiceScheme, warrantyMessage, type QuoteDraftRow } from "./quote-validation.ts";
import { apiErrorMessage } from "./api-errors.ts";

const row: QuoteDraftRow = { assetType: "Laptop", reference: "Laptop X", quantity: 1, unitCost: "1000" };
const valid = { customer: "Cliente", packageType: "Intermedio" as const, rows: [row] };

test("mantenimiento obligatorio por periodo, sin defaults y al quitar un periodo elimina su valor", () => {
  const services = { individualServices: [{ id: "maintenance", name: "Mantenimiento preventivo", unitCost: 15, unit: "Por equipo por evento", mandatory: false, active: true }] };
  const base = { serviceMode: "Servicios individuales" as const, selectedServices: [{ id: "maintenance", quantity: "", events: { 12: "1", 36: "3" } }], customServices: [], terms: [12, 36, 60] as const };
  assert.deepEqual(validateServiceScheme(base, services).errors, ["Indique el número de mantenimientos preventivos para el periodo de 60 meses."]);
  const selectedServices = pruneServiceEvents(base.selectedServices, [12, 60]);
  assert.deepEqual(selectedServices[0].events, { 12: "1" });
  for (const value of ["", "0", "-1", "1.5"]) {
    assert.ok(validateServiceScheme({ ...base, selectedServices: [{ ...base.selectedServices[0], events: { 12: value, 36: "3", 60: "5" } }] }, services).errors.length);
  }
  const complete = validateServiceScheme({ ...base, selectedServices: [{ ...base.selectedServices[0], events: { 12: "1", 36: "3", 60: "5" } }] }, services);
  assert.deepEqual(complete.errors, []);
  assert.deepEqual(complete.selectedServices[0].events, [{ termMonths: 12, quantity: 1 }, { termMonths: 36, quantity: 3 }, { termMonths: 60, quantity: 5 }]);
});

test("cantidad saliente válida y cotización solo de licencias sin servicios", () => {
  const services = { individualServices: [{ id: "outgoing", name: "Logística inversa", unitCost: 25, unit: "Por equipo saliente", mandatory: false, active: true }] };
  const input = { serviceMode: "Servicios individuales" as const, selectedServices: [{ id: "outgoing", quantity: "" }], customServices: [] };
  assert.match(validateServiceScheme(input, services).errors[0], /cantidad de equipos salientes/);
  const complete = validateServiceScheme({ ...input, selectedServices: [{ id: "outgoing", quantity: "30" }] }, services);
  assert.deepEqual(complete.selectedServices, [{ id: "outgoing", quantity: 30 }]);
  assert.deepEqual(validateServiceScheme({ ...input, physicalUnits: 0 }, services).errors, []);
});

test("cotizador sin selector Paquete y Forecast nunca se pasa a los exportadores", () => {
  const scheme = readFileSync(new URL("../components/quote-service-scheme.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(scheme, /button-service-mode|button-package-|radiogroup/);
  assert.match(scheme, /Los servicios se aplican a equipos; esta cotización solo contiene licenciamiento\./);
  for (const name of ["quote-pdf.ts", "quote-excel.ts"]) {
    assert.doesNotMatch(readFileSync(new URL(name, import.meta.url), "utf8"), /forecast/i);
  }
});

test("tarjeta Forecast multiplica el canon redondeado y explica el escenario de menor plazo", () => {
  const card = readFileSync(new URL("../components/forecast-card.tsx", import.meta.url), "utf8");
  assert.match(card, /amount\.toFixed\(2\)/);
  assert.match(card, /monthly\.times\(term\)/);
  assert.match(card, /Canon mensual .*× .* meses \(escenario de menor plazo\)/);
});

test("Forecast aparece después de escenarios y servicios, justo antes de las acciones, sin duplicado lateral", () => {
  const summary = readFileSync(new URL("../components/quote-summary-table.tsx", import.meta.url), "utf8");
  assert.ok(summary.indexOf("<ForecastCard") > summary.indexOf("<ScenarioTabs"));
  assert.ok(summary.indexOf("<ForecastCard") > summary.indexOf('data-testid="included-services"'));
  assert.match(summary, /<ForecastCard[^>]+\/>\s*<div className="quote-export">/);
  const quote = readFileSync(new URL("../pages/quote.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(quote, /ForecastCard/);
});

test("rentabilidad queda fuera de PDF/Excel y el bloqueo llega a guardar y exportar", () => {
  for (const name of ["quote-pdf.ts", "quote-excel.ts"]) {
    assert.doesNotMatch(readFileSync(new URL(name, import.meta.url), "utf8"), /profitability|commercialMargin|netMargin|netProfit|monthlyFundingRate|fundingInterest|operatingProfit/);
  }
  const quote = readFileSync(new URL("../pages/quote.tsx", import.meta.url), "utf8");
  assert.match(quote, /preview\?\.blockingErrors/);
  const summary = readFileSync(new URL("../components/quote-summary-table.tsx", import.meta.url), "utf8");
  assert.match(summary, /const canExport = errors\.length === 0/);
  assert.match(summary, /disabled=\{!canExport \|\| saving\}/);
  const saved = readFileSync(new URL("../pages/saved-quote.tsx", import.meta.url), "utf8");
  assert.match(saved, /errors=\{record\.blockingErrors \?\? \[\]\}/);
});

test("Cotización ID obligatorio y máximo 50 caracteres", () => {
  for (const id of ["", "   ", "x".repeat(51)]) assert.ok(quoteCodeError(id));
  for (const id of ["A", "ABC 123-XY", "x".repeat(50)]) assert.equal(quoteCodeError(id), null);
});

test("el conflicto 409 conserva el mensaje exacto sin prefijo HTTP", () => {
  const message = "Ya existe una cotización con el ID Mi-ID.";
  const error = Object.assign(new Error(`HTTP 409 Conflict: ${message}`), {
    status: 409, data: { error: message },
  });
  assert.equal(apiErrorMessage(error, "Error al guardar"), message);
});

test("Cotización ID aparece en formulario, listado, resumen y exportaciones sin la etiqueta anterior", () => {
  const oldLabel = ["Cliente", "ID"].join(" ");
  for (const name of ["../pages/quote.tsx", "../pages/history.tsx", "../components/quote-summary-table.tsx", "./quote-pdf.ts", "./quote-excel.ts"]) {
    const source = readFileSync(new URL(name, import.meta.url), "utf8");
    assert.ok(source.includes("Cotización ID"), name);
    assert.ok(!source.toLowerCase().includes(oldLabel.toLowerCase()), name);
  }
  const saved = readFileSync(new URL("../pages/saved-quote.tsx", import.meta.url), "utf8");
  assert.ok(saved.includes("restoreSavedQuote"));
  const source = readFileSync(new URL("../pages/quote.tsx", import.meta.url), "utf8");
  const duplicate = source.slice(source.indexOf("if (!duplicate.data"), source.indexOf("}, [duplicate.data"));
  assert.match(duplicate, /setQuoteCode\(""\)/);
  assert.doesNotMatch(duplicate, /setQuoteCode\(source\.quoteCode\)/);
  assert.match(source, /setSaveError\(apiErrorMessage\(error/);
  assert.match(duplicate, /editSnapshot.current = null/);
  assert.match(source, /\(editId \? editSnapshot.current : null\)/);
});

test("cambiar a Licenciamiento borra extensiones y volver a activo físico las exige de nuevo", () => {
  const physical = { ...row, extensions: { 60: "200" } };
  const license = changeAssetType(physical, "Licenciamiento");
  assert.deepEqual(license.extensions, {});
  assert.equal(license.warrantyExtensions, undefined);
  const restored = changeAssetType(license, "Laptop");
  const validation = validateQuoteDraft({ ...valid, terms: [36, 60], rows: [restored] }, catalog);
  assert.ok(validation.rowErrors[0].extensions?.[60]);
  assert.deepEqual(physical.extensions, { 60: "200" });
});
// Match the public catalog without importing private pricing configuration into UI tests.
const catalog = {
  assetTypes: ["Laptop", "Desktop", "AIO", "Equipo Apple", "Movilidad", "Infraestructura", "Impresión", "Accesorios"] as const,
  servicePackages: [{ packageType: "Básico" as const }, { packageType: "Intermedio" as const }, { packageType: "Premium" as const }],
};

test("el costo inválido usa el mismo mensaje en la fila y en Cálculo bloqueado", () => {
  const message = "Introduzca un costo numérico mayor que cero en USD.";
  for (const value of ["0", "abc", "$100", "COP100", "100 USD", "€100"]) {
    const result = validateQuoteDraft({ ...valid, rows: [{ ...row, unitCost: value }] }, catalog);
    assert.equal(result.rowErrors[0].unitCost, message);
    assert.ok(result.errors.includes(`Fila 1: ${message}`));
  }
});

test("el detalle no presenta parámetros originales y ningún mensaje contiene la enumeración de monedas", () => {
  const sourceDir = fileURLToPath(new URL("..", import.meta.url));
  const removed = ["parámetros", "originales"].join(" ");
  for (const source of ["pages/saved-quote.tsx", "components/quote-summary-table.tsx"]) {
    assert.ok(!readFileSync(join(sourceDir, source), "utf8").toLocaleLowerCase("es").includes(removed), source);
  }
  const banned = ["(COP", "$", "€)"].join(", ");
  function check(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) check(path);
      else if (/\.(tsx?|css)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
        assert.ok(!readFileSync(path, "utf8").includes(banned), path);
      }
    }
  }
  check(sourceDir);
});

test("USD permits plain positive decimals, including comma, and rejects foreign currencies and non-numeric data", () => {
  assert.equal(parseDecimalInput("1000,25"), 1000.25);
  assert.equal(parseDecimalInput("1000.25"), 1000.25);
  for (const value of ["", "COP 100", "$100", "100$", "€100", "100 USD", "abc", "-1", "1e3", "NaN", "Infinity", "1.000,50", "9".repeat(400)]) {
    const result = validateQuoteDraft({ ...valid, rows: [{ ...row, unitCost: value }] }, catalog);
    assert.ok(result.rowErrors[0].unitCost, value);
    assert.ok(result.errors.length > 0, value);
  }
  for (const value of ["0", "0,00", "0.0"]) {
    assert.ok(validateQuoteDraft({ ...valid, rows: [{ ...row, unitCost: value }] }, catalog).rowErrors[0].unitCost);
  }
});

test("complete valid quotes have no errors, with trimmed references and USD numbers", () => {
  const result = validateQuoteDraft({ ...valid, rows: [{ ...row, reference: " X ", unitCost: "1000,25" }] }, catalog);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].reference, "X");
  assert.equal(result.rows[0].unitCost, 1000.25);
});

test("customer, at least one complete row, and an explicitly selected package are required", () => {
  for (const input of [{ ...valid, customer: " " }, { ...valid, rows: [] }, { ...valid, packageType: null },
    { ...valid, rows: [{ ...row, reference: "" }] }, { ...valid, rows: [{ ...row, quantity: 0 }] },
    { ...valid, rows: [{ ...row, quantity: 1.5 }] }]) {
    assert.ok(validateQuoteDraft(input, catalog).errors.length > 0);
  }
  const mixed = validateQuoteDraft({ ...valid, rows: [row, { ...row, unitCost: "COP100" }] }, catalog);
  assert.ok(mixed.errors.length > 0);
  assert.ok(mixed.rowErrors[1].unitCost);
});

test("warranty is informative only, with identical copy for UI and PDF across terms", () => {
  for (const term of [12, 24, 36, 48, 60] as const) {
    assert.equal(warrantyMessage(term), `El costo unitario debe incluir la garantía del fabricante de ${term} meses. Para los periodos más largos, indique el costo de extensión de garantía.`);
  }
  assert.deepEqual(validateQuoteDraft(valid, catalog).errors, []);
});

test("modo individual no exige paquete", () => {
  const result = validateQuoteDraft({ ...valid, packageType: null, serviceMode: "Servicios individuales" }, catalog);
  assert.equal(result.packageError, null);
  assert.ok(validateQuoteDraft({ ...valid, packageType: null }, catalog).packageError);
});

test("valida servicios del catálogo y nuevos", () => {
  const services = { individualServices: [
    { id: "a", name: "Soporte", unitCost: 5, unit: "Por perfil", mandatory: true, active: true },
    { id: "b", name: "Viejo", unitCost: 5, unit: "Por equipo", mandatory: false, active: false },
  ] };
  const bad = validateServiceScheme({ serviceMode: "Servicios individuales",
    selectedServices: [{ id: "a", quantity: "0" }, { id: "b", name: "Viejo", quantity: "" }],
    customServices: [{ id: "c", name: " ", unitCost: "$10", unit: "Por evento", quantity: "1.5" }] }, services);
  assert.ok(bad.selectedErrors.a && bad.selectedErrors.b);
  assert.deepEqual(Object.keys(bad.customErrors[0]).sort(), ["name", "quantity", "unitCost"]);
  const ok = validateServiceScheme({ serviceMode: "Servicios individuales",
    selectedServices: [{ id: "a", quantity: "3" }],
    customServices: [{ id: "c", name: "Borrado", unitCost: "12,5", unit: "Por año", quantity: "" }] }, services);
  assert.equal(ok.errors.length, 0);
  assert.deepEqual(ok.selectedServices, [{ id: "a", quantity: 3 }]);
  assert.deepEqual(ok.customServices, [{ id: "c", name: "Borrado", unitCost: 12.5, unit: "Por año" }]);
  assert.equal(validateServiceScheme({ serviceMode: "Paquete", selectedServices: [], customServices: [] }, services).errors.length, 0);
});

test("periodos múltiples exigen extensión explícita para los periodos más largos", () => {
  const draft = { ...row, extensions: { 24: "", 36: "0", 60: "15" } };
  const result = validateQuoteDraft({ ...valid, rows: [draft], terms: [36, 12, 24], deliveryStatus: "Local" }, catalog);
  assert.ok(result.errors.includes("Indique el costo de extensión de garantía a 24 meses para Laptop X."));
  assert.equal(result.rowErrors[0].extensions?.[24], "Indique el costo de extensión de garantía a 24 meses para Laptop X.");
  const ok = validateQuoteDraft({ ...valid, rows: [{ ...draft, extensions: { 24: "12,5", 36: "0", 60: "15" } }], terms: [12, 24, 36], deliveryStatus: "CTO" }, catalog);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.rows[0].warrantyExtensions, [{ termMonths: 24, unitCost: 12.5 }, { termMonths: 36, unitCost: 0 }]);
  assert.ok(!("extensions" in ok.rows[0]));
  for (const bad of ["-1", "$5", "abc"]) {
    assert.ok(validateQuoteDraft({ ...valid, rows: [{ ...draft, extensions: { 24: bad, 36: "0" } }], terms: [12, 24, 36], deliveryStatus: "CTO" }, catalog).rowErrors[0].extensions?.[24]);
  }
  const single = validateQuoteDraft({ ...valid, rows: [draft], terms: [24], deliveryStatus: "CTO" }, catalog);
  assert.deepEqual(single.errors, []);
  assert.equal(single.rows[0].warrantyExtensions, undefined);
});

test("periodo mínimo y estado de entrega obligatorios", () => {
  assert.ok(validateQuoteDraft({ ...valid, terms: [], deliveryStatus: "Local" }, catalog).errors.includes("Seleccione al menos un periodo de la operación."));
  assert.ok(validateQuoteDraft({ ...valid, terms: [12], deliveryStatus: "" }, catalog).errors.includes("Seleccione el estado de entrega de los activos."));
});

test("Licenciamiento no solicita extensiones; cambiar a un activo físico vuelve a exigirlas", () => {
  const input = {
    ...valid, terms: [12, 36, 60] as (12 | 36 | 60)[], deliveryStatus: "Local" as const,
    rows: [{ ...row, assetType: "Licenciamiento" as const, extensions: { 36: "", 60: "" } }],
  };
  const licenseCatalog = { ...catalog, assetTypes: [...catalog.assetTypes, "Licenciamiento" as const] };
  const result = validateQuoteDraft(input, licenseCatalog);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].warrantyExtensions, undefined);
  const physical = validateQuoteDraft({ ...input, rows: [{ ...input.rows[0], assetType: "Laptop" as const }] }, licenseCatalog);
  assert.ok(physical.rowErrors[0].extensions?.[36]);
  assert.ok(physical.rowErrors[0].extensions?.[60]);
});

test("aceptación C: no se permite excluir ninguno de los cuatro servicios obligatorios", () => {
  const fixedCatalog = { individualServices: [
    { id: "etiquetado", name: "Etiquetado", unitCost: 3, unit: "Por equipo", mandatory: true, active: true },
    { id: "logistica-entrega", name: "Logística de entrega", unitCost: 15, unit: "Por equipo", mandatory: true, active: true },
    { id: "mesa-ayuda", name: "Mesa de ayuda", unitCost: 15, unit: "Por equipo", mandatory: true, active: true },
    { id: "logistica-inversa", name: "Logística inversa", unitCost: 10, unit: "Por equipo", mandatory: true, active: true },
  ] };
  for (const service of fixedCatalog.individualServices) {
    const result = validateServiceScheme({
      serviceMode: "Servicios individuales",
      selectedServices: fixedCatalog.individualServices.filter(row => row.id !== service.id).map(row => ({ id: row.id, quantity: "" })),
      customServices: [],
    }, fixedCatalog);
    assert.deepEqual(result.errors, [`El servicio obligatorio "${service.name}" debe estar incluido.`]);
  }
});

test("aceptación C: E14 con 12/36 exige extensión explícita y entrega antes de calcular o guardar", () => {
  const input = {
    ...valid, customer: "Aceptación C", deliveryStatus: "Local" as const, terms: [12, 36] as (12 | 36)[],
    rows: [{ ...row, reference: "E14", quantity: 50, unitCost: "1200", extensions: { 36: "" } }],
  };
  assert.ok(validateQuoteDraft(input, catalog).errors.includes("Indique el costo de extensión de garantía a 36 meses para E14."));
  const explicitZero = { ...input, rows: [{ ...input.rows[0], extensions: { 36: "0" } }] };
  assert.deepEqual(validateQuoteDraft(explicitZero, catalog).errors, []);
  assert.ok(validateQuoteDraft({ ...explicitZero, deliveryStatus: "" }, catalog).errors.includes("Seleccione el estado de entrega de los activos."));
});
