import { Router, type IRouter, type Request, type Response } from "express";
import { and, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db, quotesTable, quoteVersionsTable, appUsersTable, type AppUserRecord } from "@workspace/db";
import type { QuoteLineInput } from "@workspace/pricing";
import { CreateSavedQuoteBody, CreateSavedQuoteResponse, GetCurrentUserResponse,
  PreviewQuoteBody, PreviewQuoteResponse, CreateQuoteVersionBody, CreateQuoteVersionResponse,
  GetQuoteVersionsParams, GetQuoteVersionsResponse, GetQuoteVersionParams, GetQuoteVersionResponse,
  DeleteSavedQuoteParams, RestoreSavedQuoteParams,
  GetSavedQuoteParams, GetSavedQuoteResponse, GetSavedQuotesQueryParams, GetSavedQuotesResponse } from "@workspace/api-zod";
import { getPricingConfig } from "../lib/pricing-config";
import { quoteConfigRevision, QuotePricingError } from "../lib/quote-pricing";
import { QuoteAccessError, publicVersion, readableQuote, loadVersion, saveVersion, softDeleteQuote, restoreQuote } from "../lib/quote-storage";
import { ServiceSelectionError } from "../lib/quote-services";
import { priceScenarios, ScenarioInputError } from "../lib/quote-scenarios";
import { GenerateQuoteProposalBody } from "@workspace/api-zod";
import { buildProposalData, renderProposalDocx, proposalFilename } from "../lib/quote-proposal";
import { assertScenariosAllowed, BusinessConditionsError, publicScenarios, scenarioBlockingErrors } from "../lib/business-profitability";
import { requireRole, APP_ROLES, canViewProfitability } from "../middlewares/require-role";

const router: IRouter = Router();
router.use(requireRole(...APP_ROLES));
function validRows(rows: QuoteLineInput[]) {
  return rows.length > 0 && rows.every(row => row.reference.trim() &&
    Number.isFinite(row.unitCost) && row.unitCost > 0 &&
    Number.isSafeInteger(row.quantity) && row.quantity > 0);
}
function rejectInternalFields(body: unknown) {
  return !!body && typeof body === "object" &&
    ["margin", "configSnapshot", "commercialMargin", "profitability", "profitAndLoss", "netMargin", "netProfit"]
      .some(key => key in body);
}
function reportPricingFailure(req: Request, error: unknown, res: Response) {
  if (error instanceof QuoteAccessError || error instanceof ServiceSelectionError || error instanceof ScenarioInputError || error instanceof BusinessConditionsError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof QuotePricingError) {
    req.log.error({ detail: error.detail }, "Approved quote pricing rejected");
    res.status(422).json({ error: error.message });
    return;
  }
  req.log.error({ errorName: error instanceof Error ? error.name : "Unknown" }, "Quote calculation failed");
  res.status(500).json({ error: "No se pudo generar la cotización. Inténtelo de nuevo." });
}
router.get("/auth/me", (_req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.json(GetCurrentUserResponse.parse(res.locals.appUser));
});
const guarded = (handler: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
  try { await handler(req, res); } catch (error) { reportPricingFailure(req, error, res); }
};
router.get("/quotes", guarded(async (req, res) => {
  if (req.query.belowTarget !== undefined && !["true", "false"].includes(String(req.query.belowTarget)))
    throw new QuoteAccessError(400, "Filtro de margen inválido.");
  if (req.query.showDeleted !== undefined && !["true", "false"].includes(String(req.query.showDeleted))) {
    res.status(400).json({ error: "Filtro de eliminadas inválido." }); return;
  }
  const parsed = GetSavedQuotesQueryParams.safeParse({
    ...req.query, showDeleted: req.query.showDeleted === "true", belowTarget: req.query.belowTarget === "true",
  });
  if (!parsed.success) { res.status(400).json({ error: "Búsqueda o página inválida." }); return; }
  const user = res.locals.appUser as AppUserRecord;
  if (parsed.data.belowTarget && !canViewProfitability(user))
    throw new QuoteAccessError(403, "Filtro disponible solo para administradores.");
  if (parsed.data.showDeleted && !canViewProfitability(user))
    throw new QuoteAccessError(403, "Solo un administrador puede consultar cotizaciones eliminadas.");
  const page = parsed.data.page ?? 1;
  const pageSize = 25;
  const search = parsed.data.search?.trim().replace(/[\\%_]/g, "\\$&");
  const where = and(canViewProfitability(user) ? undefined : eq(quotesTable.ownerId, user.id),
    parsed.data.showDeleted ? undefined : isNull(quotesTable.deletedAt),
    parsed.data.belowTarget ? sql`exists (select 1 from jsonb_array_elements(coalesce(${quoteVersionsTable.scenarios}, '[]'::jsonb)) s where s->'profitability'->>'status' = 'Bajo objetivo')` : undefined,
    search ? or(ilike(quoteVersionsTable.customer, `%${search}%`),
      ilike(quotesTable.quoteCode, `%${search}%`)) : undefined);
  const [items, [total]] = await Promise.all([
    db.select({ quote: quotesTable, version: quoteVersionsTable, name: appUsersTable.name, isBlocked: appUsersTable.isBlocked }).from(quotesTable)
      .innerJoin(quoteVersionsTable, eq(quoteVersionsTable.id, quotesTable.currentVersionId))
      .innerJoin(appUsersTable, eq(appUsersTable.id, quoteVersionsTable.createdBy))
      .where(where).orderBy(desc(quotesTable.updatedAt), desc(quotesTable.id))
      .limit(pageSize).offset((page - 1) * pageSize),
    db.select({ value: count() }).from(quotesTable)
      .innerJoin(quoteVersionsTable, eq(quoteVersionsTable.id, quotesTable.currentVersionId)).where(where),
  ]);
  res.setHeader("Cache-Control", "private, no-store");
  res.json(GetSavedQuotesResponse.parse({ items: items.map(item => publicVersion(item.quote, item.version, item.name, canViewProfitability(user), item.isBlocked)),
    total: total?.value ?? 0, page, pageSize }));
}));
router.get("/quotes/:id", guarded(async (req, res) => {
  const parsed = GetSavedQuoteParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Identificador inválido." }); return; }
  const user = res.locals.appUser as AppUserRecord;
  const record = await readableQuote(parsed.data.id, user);
  res.setHeader("Cache-Control", "private, no-store");
  res.json(GetSavedQuoteResponse.parse(await loadVersion(record, undefined, canViewProfitability(user))));
}));
router.get("/quotes/:id/versions", guarded(async (req, res) => {
  const parsed = GetQuoteVersionsParams.safeParse(req.params);
  if (!parsed.success) throw new QuoteAccessError(400, "Identificador inválido.");
  const quote = await readableQuote(parsed.data.id, res.locals.appUser);
  const items = await db.select({
    id: quoteVersionsTable.id, quoteId: quoteVersionsTable.quoteId,
    versionNumber: quoteVersionsTable.versionNumber, customer: quoteVersionsTable.customer,
    createdAt: quoteVersionsTable.createdAt, createdBy: quoteVersionsTable.createdBy,
    createdByName: sql<string>`coalesce(nullif(${quoteVersionsTable.createdByName}, ''), ${appUsersTable.name})`,
    createdByBlocked: appUsersTable.isBlocked,
    totalMonthlyBeforeTax: quoteVersionsTable.totalMonthlyBeforeTax,
  }).from(quoteVersionsTable).innerJoin(appUsersTable, eq(appUsersTable.id, quoteVersionsTable.createdBy))
    .where(eq(quoteVersionsTable.quoteId, quote.id)).orderBy(desc(quoteVersionsTable.versionNumber));
  res.setHeader("Cache-Control", "private, no-store");
  res.json(GetQuoteVersionsResponse.parse({
    items: items.map(({ createdByBlocked, ...item }) => ({ ...item,
      ...(canViewProfitability(res.locals.appUser) ? { createdByBlocked } : {}),
      ...(res.locals.appUser.role === "admin" ? { config_snapshot_at: item.createdAt } : {}) })),
    currentVersionId: quote.currentVersionId,
  }));
}));
router.get("/quotes/:id/versions/:versionId", guarded(async (req, res) => {
  const parsed = GetQuoteVersionParams.safeParse(req.params);
  if (!parsed.success) throw new QuoteAccessError(400, "Identificador inválido.");
  const quote = await readableQuote(parsed.data.id, res.locals.appUser);
  res.setHeader("Cache-Control", "private, no-store");
  res.json(GetQuoteVersionResponse.parse(await loadVersion(quote, parsed.data.versionId, canViewProfitability(res.locals.appUser))));
}));
router.delete("/quotes/:id", guarded(async (req, res) => {
  const parsed = DeleteSavedQuoteParams.safeParse(req.params);
  if (!parsed.success) throw new QuoteAccessError(400, "Identificador inválido.");
  await softDeleteQuote(parsed.data.id, res.locals.appUser);
  res.json({ success: true });
}));
router.post("/quotes/:id/versions/:versionId/proposal-docx", guarded(async (req, res) => {
  const params = GetQuoteVersionParams.safeParse(req.params);
  const body = GenerateQuoteProposalBody.safeParse(req.body);
  if (!params.success || !body.success)
    throw new QuoteAccessError(400, "Complete destinatario, razón social y sedes.");
  const quote = await readableQuote(params.data.id, res.locals.appUser);
  const internalVersion = await loadVersion(quote, params.data.versionId, true);
  assertScenariosAllowed(internalVersion.scenarios);
  const version = GetQuoteVersionResponse.parse(await loadVersion(quote, params.data.versionId));
  const details = {
    destinatario: body.data.destinatario.trim(), razonSocial: body.data.razonSocial.trim(), sedes: body.data.sedes.trim(),
  };
  const now = new Date();
  const document = renderProposalDocx(buildProposalData(version, details, now));
  await db.update(quoteVersionsTable).set({ proposalDetails: details })
    .where(and(eq(quoteVersionsTable.id, version.versionId), eq(quoteVersionsTable.quoteId, quote.id)));
  const filename = proposalFilename(version.customer, version.versionNumber, now);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(document);
}));
router.post("/quotes/:id/restore", requireRole("admin"), guarded(async (req, res) => {
  const parsed = RestoreSavedQuoteParams.safeParse(req.params);
  if (!parsed.success) throw new QuoteAccessError(400, "Identificador inválido.");
  await restoreQuote(parsed.data.id, res.locals.appUser);
  res.json({ success: true });
}));
router.post("/quotes/preview", async (req, res) => {
  if (rejectInternalFields(req.body)) {
    res.status(400).json({ error: "Los parámetros de cálculo se determinan en el servidor." });
    return;
  }
  const parsed = PreviewQuoteBody.safeParse(req.body);
  if (!parsed.success || !validRows(parsed.data.rows)) {
    res.status(400).json({ error: "Complete las referencias, las cantidades y los importes en USD." });
    return;
  }
  try {
    const config = await getPricingConfig();
    const rows = parsed.data.rows.map(row => ({ ...row, reference: row.reference.trim() }));
    const priced = priceScenarios({ ...parsed.data, rows }, config);
    res.setHeader("Cache-Control", "private, no-store");
    res.json(PreviewQuoteResponse.parse({
      results: priced.results, totalMonthlyBeforeTax: priced.totalMonthlyBeforeTax,
      configRevision: quoteConfigRevision(config),
      includedServices: priced.services.includedServices,
      scenarios: publicScenarios(priced.scenarios, canViewProfitability(res.locals.appUser)), forecast: priced.forecast,
      blockingErrors: scenarioBlockingErrors(priced.scenarios),
    }));
  } catch (error) { reportPricingFailure(req, error, res); }
});
router.post("/quotes", guarded(async (req, res) => {
  if (rejectInternalFields(req.body)) {
    res.status(400).json({ error: "Los parámetros de cálculo se determinan en el servidor." });
    return;
  }
  const parsed = CreateSavedQuoteBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Revise los campos obligatorios y los importes en USD." }); return; }
  const body = parsed.data;
  const user = res.locals.appUser as AppUserRecord;
  const customer = body.customer.trim();
  const rows = body.rows.map(row => ({ ...row, reference: row.reference.trim() }));
  if (!customer || !validRows(rows)) {
    res.status(400).json({ error: "Cliente y referencias son obligatorios; los costos deben ser mayores que cero en USD." });
    return;
  }
  res.status(201).json(CreateSavedQuoteResponse.parse(await saveVersion(user, { ...body, customer, quoteCode: body.quoteCode.trim(), rows })));
}));
router.post("/quotes/:id/versions", guarded(async (req, res) => {
  const params = GetSavedQuoteParams.safeParse(req.params);
  if (!params.success) throw new QuoteAccessError(400, "Identificador inválido.");
  if (rejectInternalFields(req.body))
    throw new QuoteAccessError(400, "Los parámetros de cálculo se determinan en el servidor.");
  const parsed = CreateQuoteVersionBody.safeParse(req.body);
  if (!parsed.success) throw new QuoteAccessError(400, "Revise los campos obligatorios y los importes en USD.");
  const body = parsed.data;
  const customer = body.customer.trim();
  const rows = body.rows.map(row => ({ ...row, reference: row.reference.trim() }));
  if (!customer || !validRows(rows)) throw new QuoteAccessError(400, "Complete cliente, referencias, cantidades e importes en USD.");
  res.status(201).json(CreateQuoteVersionResponse.parse(await saveVersion(res.locals.appUser,
    { ...body, customer, quoteCode: body.quoteCode.trim(), rows }, params.data.id)));
}));
export default router;
