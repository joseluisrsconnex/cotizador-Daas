import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq, sql } from "drizzle-orm";
import { db, appUsersTable, quotesTable, quoteVersionsTable, pricingConfigsTable,
  type AppUserRecord, type QuoteRecord, type QuoteVersionRecord } from "@workspace/db";
import { GetDaasConfigResponse } from "@workspace/api-zod";
import type { PricingConfig, QuoteServiceSnapshot } from "@workspace/pricing";
import { quoteConfigRevision, QuotePricingError } from "./quote-pricing";
import { priceScenarios, type ScenarioInput } from "./quote-scenarios";
import { contractForecast } from "./quote-forecast";
import { assertScenariosAllowed, publicScenarios, scenarioBlockingErrors } from "./business-profitability";
import { canViewProfitability } from "../middlewares/require-role";

export class QuoteAccessError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function mayManageQuote(user: Pick<AppUserRecord, "id" | "role">, quote: Pick<QuoteRecord, "ownerId">) {
  return canViewProfitability(user) || user.id === quote.ownerId;
}

export function mayReadQuote(user: Pick<AppUserRecord, "id" | "role">, quote: Pick<QuoteRecord, "ownerId" | "deletedAt">) {
  return canViewProfitability(user) || (user.id === quote.ownerId && !quote.deletedAt);
}

export function publicVersion(quote: QuoteRecord, version: QuoteVersionRecord, createdByName: string, isAdmin = false, createdByBlocked = false) {
  const snapshot = version.serviceSelection as QuoteServiceSnapshot | null;
  const legacyConfig = version.configSnapshot as PricingConfig;
  const legacyPackage = legacyConfig.servicePackages?.find(row => row.packageType === version.packageType);
  const services: QuoteServiceSnapshot = snapshot ?? {
    serviceMode: "Paquete", selectedServices: [], customServices: [],
    includedServices: legacyPackage ? [{
      id: `package:${version.packageType}`, name: `Paquete ${version.packageType}: ${legacyPackage.detail}`,
      unitCost: legacyPackage.unitCost, unit: "Por equipo",
    }] : [],
  };
  const scenarios = version.scenarios as ReturnType<typeof priceScenarios>["scenarios"] | null ??
    [{ termMonths: version.termMonths, results: version.results, totalMonthlyBeforeTax: version.totalMonthlyBeforeTax }];
  return {
    id: quote.id, ownerId: quote.ownerId, currentVersionId: quote.currentVersionId,
    versionId: version.id, versionNumber: version.versionNumber,
    customer: version.customer, quoteCode: quote.quoteCode,
    ...(version.proposalDetails ? { proposalDetails: version.proposalDetails } : {}),
    createdAt: version.createdAt, updatedAt: quote.updatedAt,
    createdBy: version.createdBy, createdByName: version.createdByName || createdByName, deletedAt: quote.deletedAt, deletedBy: quote.deletedBy,
    ...(isAdmin ? { createdByBlocked } : {}),
    termMonths: version.termMonths, packageType: services.serviceMode === "Paquete" ? version.packageType : null,
    ...services, rows: version.rows, results: version.results,
    scenarios: publicScenarios(scenarios, isAdmin), terms: scenarios.map(scenario => scenario.termMonths), deliveryStatus: version.deliveryStatus,
    blockingErrors: scenarioBlockingErrors(scenarios),
    totalMonthlyBeforeTax: version.totalMonthlyBeforeTax,
    forecast: version.forecast ?? contractForecast(scenarios),
    ...(isAdmin ? { config_snapshot_at: version.createdAt } : {}),
    configRevision: quoteConfigRevision(version.configSnapshot as PricingConfig),
  };
}

export async function readableQuote(id: string, user: AppUserRecord) {
  const [quote] = await db.select().from(quotesTable).where(eq(quotesTable.id, id)).limit(1);
  if (!quote) throw new QuoteAccessError(404, "Cotización no encontrada.");
  if (!mayReadQuote(user, quote)) throw new QuoteAccessError(quote.deletedAt && quote.ownerId === user.id ? 404 : 403, "No tiene permiso para ver esta cotización.");
  return quote;
}

export async function loadVersion(quote: QuoteRecord, versionId = quote.currentVersionId, isAdmin = false) {
  if (!versionId) throw new Error("Quote version migration incomplete");
  const [record] = await db.select({ version: quoteVersionsTable, name: appUsersTable.name, isBlocked: appUsersTable.isBlocked })
    .from(quoteVersionsTable).innerJoin(appUsersTable, eq(appUsersTable.id, quoteVersionsTable.createdBy))
    .where(and(eq(quoteVersionsTable.id, versionId), eq(quoteVersionsTable.quoteId, quote.id))).limit(1);
  if (!record) throw new QuoteAccessError(404, "Versión no encontrada.");
  return publicVersion(quote, record.version, record.name, isAdmin, record.isBlocked);
}

interface SaveInput extends ScenarioInput {
  requestId: string;
  customer: string;
  quoteCode: string;
  expectedRevision: string;
  baseVersionId?: string;
}

function matchesAttempt(version: QuoteVersionRecord, input: SaveInput, actorId: string) {
  const saved = version.serviceSelection as QuoteServiceSnapshot | null;
  const mode = input.serviceMode ?? (input.packageType ? "Paquete" : "Servicios individuales");
  return version.createdBy === actorId && version.customer === input.customer &&
    version.quoteCode === input.quoteCode &&
    version.termMonths === input.termMonths && version.packageType === (input.packageType ?? "Servicios individuales") &&
    version.deliveryStatus === input.deliveryStatus &&
    isDeepStrictEqual((version.scenarios as Array<{ termMonths: number }> | null)?.map(row => row.termMonths) ?? [version.termMonths],
      [...(input.terms ?? [input.termMonths])].sort((a, b) => a - b)) &&
    (saved?.serviceMode ?? "Paquete") === mode &&
    isDeepStrictEqual(saved?.customServices ?? [], (input.customServices ?? []).map(row => ({ ...row, name: row.name.trim() }))) &&
    isDeepStrictEqual(saved?.selectedServices ?? [], input.selectedServices ?? []) &&
    isDeepStrictEqual(version.rows, input.rows) &&
    quoteConfigRevision(version.configSnapshot as PricingConfig) === input.expectedRevision;
}

/** Quote row lock serializes version numbers, deletes, and concurrent editor saves. */
export async function saveVersion(user: AppUserRecord, input: SaveInput, quoteId?: string) {
  input = { ...input, quoteCode: input.quoteCode?.trim() };
  if (!input.quoteCode || input.quoteCode.length > 50)
    throw new QuoteAccessError(400, "El Cotización ID es obligatorio y no puede superar 50 caracteres.");
  try { return await db.transaction(async tx => {
    // Serialize retries of a new-quote request, including the first version and its pointer.
    if (!quoteId) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${user.id}:${input.requestId}`}))`);
    const [quote] = quoteId
      ? await tx.select().from(quotesTable).where(eq(quotesTable.id, quoteId)).for("update").limit(1)
      : await tx.select().from(quotesTable).where(and(eq(quotesTable.ownerId, user.id),
        eq(quotesTable.requestId, input.requestId))).for("update").limit(1);
    if (quoteId && !quote) throw new QuoteAccessError(404, "Cotización no encontrada.");
    if (quote && !mayManageQuote(user, quote)) throw new QuoteAccessError(403, "No tiene permiso para editar esta cotización.");
    if (quote?.deletedAt) throw new QuoteAccessError(409, "Restaure la cotización antes de editarla.");
    if (quote) {
      const [previousAttempt] = await tx.select().from(quoteVersionsTable).where(and(
        eq(quoteVersionsTable.quoteId, quote.id), eq(quoteVersionsTable.requestId, input.requestId))).limit(1);
      if (previousAttempt) {
        if (!matchesAttempt(previousAttempt, input, user.id))
          throw new QuoteAccessError(409, "Este intento de guardado ya se utilizó con otros datos.");
        return publicVersion(quote, previousAttempt, user.name, canViewProfitability(user), user.isBlocked);
      }
    }
    if (quoteId && quote?.currentVersionId !== input.baseVersionId)
      throw new QuoteAccessError(409, "La cotización tiene una versión más reciente. Abra la versión actual antes de editar.");

    // A shared pricing lock prevents an admin changing the approved configuration mid-save.
    const [settings] = await tx.select().from(pricingConfigsTable)
      .where(eq(pricingConfigsTable.id, "default")).for("share").limit(1);
    const parsedConfig = GetDaasConfigResponse.safeParse(settings?.config);
    if (!parsedConfig.success) throw new QuotePricingError("Configuración persistida inválida al guardar la versión.");
    const config = parsedConfig.data as PricingConfig;
    const priced = priceScenarios(input, config);
    assertScenariosAllowed(priced.scenarios);
    if (quoteConfigRevision(config) !== input.expectedRevision)
      throw new QuoteAccessError(409, "Los parámetros cambiaron. Actualice esta cotización antes de guardarla.");
    const content = {
      customer: input.customer, quoteCode: input.quoteCode,
      termMonths: input.termMonths, packageType: input.packageType ?? "Servicios individuales",
      serviceSelection: priced.services,
      scenarios: priced.scenarios, forecast: priced.forecast, deliveryStatus: input.deliveryStatus,
      rows: input.rows, results: priced.results, totalMonthlyBeforeTax: priced.totalMonthlyBeforeTax,
      configSnapshot: config, margin: priced.margin,
    };
    let parent = quote;
    if (!parent) {
      [parent] = await tx.insert(quotesTable).values({
        id: randomUUID(), ownerId: user.id, requestId: input.requestId, ...content,
      }).returning();
    }
    if (!parent) throw new Error("Quote insert unavailable");
    // The shared identity is updated atomically, including earlier versions.
    // The database trigger changes only this metadata, never saved pricing.
    if (parent.quoteCode !== input.quoteCode)
      await tx.update(quotesTable).set({ quoteCode: input.quoteCode }).where(eq(quotesTable.id, parent.id));
    // The locked parent serializes writers. Never derive numbering from its pointer,
    // the browser, or the number of records: gaps and stale pointers are possible.
    const [next] = await tx.select({
      number: sql<number>`coalesce(max(${quoteVersionsTable.versionNumber}), 0) + 1`,
    }).from(quoteVersionsTable).where(eq(quoteVersionsTable.quoteId, parent.id));
    const number = next!.number;
    const [version] = await tx.insert(quoteVersionsTable).values({
      id: randomUUID(), quoteId: parent.id, versionNumber: number,
      requestId: input.requestId, createdBy: user.id, createdByName: user.name, ...content,
    }).returning();
    if (!version) throw new Error("Version insert unavailable");
    const [updated] = await tx.update(quotesTable).set({
      ...content, currentVersionId: version.id, updatedAt: version.createdAt,
    }).where(eq(quotesTable.id, parent.id)).returning();
    if (!updated) throw new Error("Version pointer update unavailable");
    return publicVersion(updated, version, user.name, canViewProfitability(user), user.isBlocked);
  }); } catch (error) { throwCodeConflict(error, input.quoteCode); }
}

/** Drizzle wraps PostgreSQL errors in cause; translate only our unique index. */
function throwCodeConflict(error: unknown, code: string): never {
  let current: unknown = error;
  while (current && typeof current === "object") {
    const pg = current as { code?: string; constraint?: string; cause?: unknown };
    if (pg.code === "23505" && pg.constraint === "quotes_active_code_idx")
      throw new QuoteAccessError(409, `Ya existe una cotización con el ID ${code}.`);
    current = pg.cause;
  }
  throw error;
}

export async function softDeleteQuote(id: string, user: AppUserRecord) {
  await db.transaction(async tx => {
    const [quote] = await tx.select().from(quotesTable).where(eq(quotesTable.id, id)).for("update").limit(1);
    if (!quote) throw new QuoteAccessError(404, "Cotización no encontrada.");
    if (user.role !== "admin" && user.id !== quote.ownerId) throw new QuoteAccessError(403, "No tiene permiso para eliminar esta cotización.");
    if (!quote.deletedAt) await tx.update(quotesTable).set({
      deletedAt: new Date(), deletedBy: user.id, updatedAt: new Date(),
    }).where(eq(quotesTable.id, id));
  });
}

export async function restoreQuote(id: string, user: AppUserRecord) {
  if (user.role !== "admin") throw new QuoteAccessError(403, "Solo un administrador puede restaurar cotizaciones.");
  let code = "";
  try { await db.transaction(async tx => {
    const [quote] = await tx.select().from(quotesTable).where(eq(quotesTable.id, id)).for("update").limit(1);
    if (!quote) throw new QuoteAccessError(404, "Cotización no encontrada.");
    code = quote.quoteCode;
    if (quote.deletedAt) await tx.update(quotesTable).set({
      deletedAt: null, deletedBy: null, updatedAt: new Date(),
    }).where(eq(quotesTable.id, id));
  }); } catch (error) { throwCodeConflict(error, code); }
}
