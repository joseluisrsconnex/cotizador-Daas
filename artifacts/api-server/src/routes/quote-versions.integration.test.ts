import express from "express";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool, appUsersTable, quotesTable, quoteVersionsTable, pricingConfigsTable, type AppUserRecord } from "@workspace/db";
import { clonePricingConfig, DEFAULT_PRICING_CONFIG } from "@workspace/pricing";
import router from "./quotes";
import daasRouter from "./daas";
import { normalizePricingConfig, percentToFraction } from "@workspace/pricing/normalization";
import { getPricingConfig, ensurePricingMigration } from "../lib/pricing-config";
import { quoteConfigRevision, priceQuote } from "../lib/quote-pricing";
import { ensureQuoteVersionMigration } from "../lib/quote-version-migration";
import { migrateQuoteVersionNumbers } from "../lib/quote-numbering-migration";
import { migrateQuoteScenarios } from "../lib/quote-scenario-migration";
import { QUOTE_UNAVAILABLE } from "../lib/quote-pricing";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

describe("Cotizaciones versionadas: API y persistencia PostgreSQL", () => {
  const token = randomUUID();
  const users = {
    owner: { id: `version-test-owner-${token}`, email: `owner-${token}@example.invalid`, name: "Prueba de versiones A", role: "comercial" as const },
    other: { id: `version-test-other-${token}`, email: `other-${token}@example.invalid`, name: "Prueba de versiones B", role: "comercial" as const },
    admin: { id: `version-test-admin-${token}`, email: `admin-${token}@example.invalid`, name: "Prueba de versiones Admin", role: "admin" as const },
  };
  let server: Server;
  let url: string;
  let config: Awaited<ReturnType<typeof getPricingConfig>>;
  let first: any;
  let second: any;
  let editBody: any;
  let originalVersion: any;

  async function request(actor: keyof typeof users, path: string, method = "GET", data?: unknown) {
    const res = await fetch(`${url}${path}`, {
      method, headers: { "Content-Type": "application/json", "x-test-actor": actor },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    return { status: res.status, body: await res.json() as any };
  }
  function payload(customer = `Quote fixture ${token}`) {
    return {
      requestId: randomUUID(), customer, quoteCode: `ID-${randomUUID()}`, termMonths: 36 as const, packageType: "Básico" as const,
      deliveryStatus: "Local" as const,
      rows: [{ assetType: "Laptop" as const, reference: "Referencia de prueba", quantity: 31, unitCost: 1200 }],
      expectedRevision: quoteConfigRevision(config),
    };
  }

  beforeAll(async () => {
    await ensurePricingMigration();
    await ensureQuoteVersionMigration();
    config = await getPricingConfig();
    await db.insert(appUsersTable).values(Object.values(users));
    const app = express();
    app.use(express.json());
    // Test-only auth adapter. The real application still uses verified Clerk middleware.
    app.use((req, res, next) => {
      const key = req.headers["x-test-actor"] as keyof typeof users;
      res.locals.appUser = { ...users[key], createdAt: new Date(), isBlocked: false, lastAccessAt: null } satisfies AppUserRecord;
      req.log = { error: () => undefined } as unknown as typeof req.log;
      next();
    });
    app.use(router);
    app.use(daasRouter);
    server = await new Promise<Server>(resolve => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server unavailable");
    url = `http://127.0.0.1:${address.port}`;
    const created = await request("owner", "/quotes", "POST", payload());
    expect(created.status).toBe(201);
    first = created.body;
    [originalVersion] = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.id, first.versionId));
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    const actorIds = Object.values(users).map(user => user.id);
    const ownQuotes = await db.select({ id: quotesTable.id }).from(quotesTable)
      .where(inArray(quotesTable.ownerId, actorIds));
    if (ownQuotes.length) {
      const ids = ownQuotes.map(quote => quote.id);
      await db.update(quotesTable).set({ currentVersionId: null }).where(inArray(quotesTable.id, ids));
      await db.delete(quoteVersionsTable).where(inArray(quoteVersionsTable.quoteId, ids));
      await db.delete(quotesTable).where(inArray(quotesTable.id, ids));
    }
    await db.delete(appUsersTable).where(inArray(appUsersTable.id, actorIds));
    await pool.end();
  });

  it("Cotización ID se valida, se comparte entre versiones y permite buscar sin perder el nombre", async () => {
    for (const quoteCode of [undefined, "", "   ", "X".repeat(51)]) {
      const input = { ...payload(), quoteCode };
      expect((await request("owner", "/quotes", "POST", input)).status).toBe(400);
    }
    const input = { ...payload(`Cliente de identificador ${token}`), quoteCode: `  CLIENT-${token}  ` };
    const created = await request("owner", "/quotes", "POST", input);
    expect(created.status).toBe(201);
    expect(created.body.quoteCode).toBe(`CLIENT-${token}`);
    const [before] = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.id, created.body.versionId));
    const updated = await request("owner", `/quotes/${created.body.id}/versions`, "POST", {
      ...input, quoteCode: `NUEVO-${token}`, requestId: randomUUID(), baseVersionId: created.body.versionId,
    });
    expect(updated.status).toBe(201);
    const old = await request("owner", `/quotes/${created.body.id}/versions/${created.body.versionId}`);
    expect(old.body.quoteCode).toBe(`NUEVO-${token}`);
    const latest = await request("owner", `/quotes/${created.body.id}`);
    expect(latest.body.quoteCode).toBe(`NUEVO-${token}`);
    const storedVersions = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.quoteId, created.body.id));
    expect(storedVersions.map(v => v.quoteCode)).toEqual([`NUEVO-${token}`, `NUEVO-${token}`]);
    const previous = storedVersions.find(v => v.id === created.body.versionId)!;
    expect({ ...previous, quoteCode: before!.quoteCode }).toEqual(before);
    for (const search of [`NUEVO-${token}`, `Cliente de identificador ${token}`]) {
      const found = await request("owner", `/quotes?search=${encodeURIComponent(search)}`);
      expect(found.body.items.some((item: any) => item.id === created.body.id)).toBe(true);
    }
    const denied = await request("other", `/quotes?search=${encodeURIComponent(`NUEVO-${token}`)}`);
    expect(denied.body.items.some((item: any) => item.id === created.body.id)).toBe(false);
  });

  it("la unicidad es global, ignora mayúsculas y devuelve el mensaje exacto incluso entre propietarios", async () => {
    const code = `Unique-${randomUUID()}`;
    const created = await request("owner", "/quotes", "POST", { ...payload(), quoteCode: code });
    expect(created.status).toBe(201);
    for (const actor of ["owner", "other", "admin"] as const) {
      const conflict = await request(actor, "/quotes", "POST", { ...payload(), quoteCode: code.toLowerCase() });
      expect(conflict).toEqual({ status: 409, body: { error: `Ya existe una cotización con el ID ${code.toLowerCase()}.` } });
    }
    const other = await request("other", "/quotes", "POST", payload());
    const updateConflict = await request("other", `/quotes/${other.body.id}/versions`, "POST", {
      ...payload(), quoteCode: code, baseVersionId: other.body.versionId,
    });
    expect(updateConflict).toEqual({ status: 409, body: { error: `Ya existe una cotización con el ID ${code}.` } });
    expect((await request("other", `/quotes/${other.body.id}`)).body.versionId).toBe(other.body.versionId);
    const own = await request("owner", `/quotes/${created.body.id}/versions`, "POST", {
      ...payload(), quoteCode: code, baseVersionId: created.body.versionId,
    });
    expect(own.status).toBe(201);
  });

  it("dos propietarios concurrentes obtienen solo un guardado para el mismo ID", async () => {
    const code = `Race-${randomUUID()}`;
    const results = await Promise.all([
      request("owner", "/quotes", "POST", { ...payload(), quoteCode: code }),
      request("other", "/quotes", "POST", { ...payload(), quoteCode: code.toUpperCase() }),
    ]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    const failed = results.find(r => r.status === 409)!;
    expect(failed.body.error).toMatch(/^Ya existe una cotización con el ID .+\.$/);
  });

  it("borrar libera el ID y restaurar en conflicto no modifica la cotización ni sus versiones", async () => {
    const code = `Restore-${randomUUID()}`;
    const a = await request("owner", "/quotes", "POST", { ...payload(), quoteCode: code });
    expect(a.status).toBe(201);
    expect((await request("owner", `/quotes/${a.body.id}`, "DELETE")).status).toBe(200);
    const [before] = await db.select().from(quotesTable).where(eq(quotesTable.id, a.body.id));
    const versions = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.quoteId, a.body.id));
    const b = await request("other", "/quotes", "POST", { ...payload(), quoteCode: code.toLowerCase() });
    expect(b.status).toBe(201);
    expect(await request("admin", `/quotes/${a.body.id}/restore`, "POST")).toEqual({
      status: 409, body: { error: `Ya existe una cotización con el ID ${code}.` },
    });
    const [after] = await db.select().from(quotesTable).where(eq(quotesTable.id, a.body.id));
    expect(after).toEqual(before);
    expect(await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.quoteId, a.body.id))).toEqual(versions);
    expect((await request("other", `/quotes/${b.body.id}`, "DELETE")).status).toBe(200);
    expect((await request("admin", `/quotes/${a.body.id}/restore`, "POST")).status).toBe(200);
  });

  it("restaurar y crear concurrentemente con el mismo ID solo permite una cotización activa", async () => {
    const code = `RestoreRace-${randomUUID()}`;
    const a = await request("owner", "/quotes", "POST", { ...payload(), quoteCode: code });
    expect(a.status).toBe(201);
    await request("owner", `/quotes/${a.body.id}`, "DELETE");
    const [restore, create] = await Promise.all([
      request("admin", `/quotes/${a.body.id}/restore`, "POST"),
      request("other", "/quotes", "POST", { ...payload(), quoteCode: code.toLowerCase() }),
    ]);
    expect([restore.status, create.status]).toSatisfy(
      (statuses: number[]) => JSON.stringify(statuses) === "[200,409]" || JSON.stringify(statuses) === "[409,201]",
    );
    const failed = restore.status === 409 ? restore : create;
    const failedCode = restore.status === 409 ? code : code.toLowerCase();
    expect(failed.body.error).toBe(`Ya existe una cotización con el ID ${failedCode}.`);
  });

  it("Word aplica permisos de lectura, guarda los datos solo en la versión elegida y no cambia los resultados", async () => {
    const input = { ...payload("Empresa Ágil"), termMonths: 24, terms: [24, 36, 60], deliveryStatus: "CTO",
      rows: [
        { assetType: "Laptop", reference: "Equipo prueba", quantity: 95, unitCost: 1200,
          warrantyExtensions: [{ termMonths: 36, unitCost: 20 }, { termMonths: 60, unitCost: 40 }] },
        { assetType: "Licenciamiento", reference: "Licencia prueba", quantity: 20, unitCost: 100 },
      ] };
    const created = await request("owner", "/quotes", "POST", input);
    expect(created.status).toBe(201);
    const quote = created.body;
    const revised = await request("owner", `/quotes/${quote.id}/versions`, "POST", {
      ...input, requestId: randomUUID(), baseVersionId: quote.versionId,
    });
    expect(revised.status).toBe(201);
    const [before] = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.id, quote.versionId));
    const details = { destinatario: "Compras", razonSocial: "Empresa Ágil S.A.", sedes: "Bogotá y Medellín" };
    const generate = (actor: keyof typeof users, versionId: string, body: unknown = details) => fetch(
      `${url}/quotes/${quote.id}/versions/${versionId}/proposal-docx`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-test-actor": actor }, body: JSON.stringify(body),
      });
    expect((await generate("other", quote.versionId)).status).toBe(403);
    expect((await generate("owner", randomUUID())).status).toBe(404);
    expect((await generate("owner", revised.body.versionId, { ...details, destinatario: " " })).status).toBe(400);
    const result = await generate("owner", quote.versionId);
    expect(result.status).toBe(200);
    expect(result.headers.get("Content-Type")).toContain("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(result.headers.get("Content-Disposition")).toContain("v1_");
    const buffer = Buffer.from(await result.arrayBuffer());
    const output = new Docxtemplater(new PizZip(buffer)).getFullText();
    expect(output.match(/ESCENARIO \d/g)).toHaveLength(3);
    expect(output).not.toMatch(/[{}]/);
    expect(output).toContain("51 a 100 equipos");
    expect(output).toContain("Plazo de entrega correspondiente: 60 días calendario");
    const reread = await request("owner", `/quotes/${quote.id}/versions/${quote.versionId}`);
    expect(reread.body.proposalDetails).toEqual(details);
    expect(reread.body.results).toEqual(quote.results);
    expect(reread.body.scenarios).toEqual(quote.scenarios);
    const [after] = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.id, quote.versionId));
    expect({ ...after, proposalDetails: null }).toEqual({ ...before, proposalDetails: null });
    const latest = await request("owner", `/quotes/${quote.id}`);
    expect(latest.body.proposalDetails).toBeUndefined();
    expect(latest.body.versionId).toBe(revised.body.versionId);
    expect((await generate("admin", revised.body.versionId)).status).toBe(200);
    const versions = await request("owner", `/quotes/${quote.id}/versions`);
    expect(versions.body.items).toHaveLength(2);
  });

  it("rechaza con 403 editar o eliminar cotizaciones ajenas y restaurar como comercial", async () => {
    const input = { ...payload(), baseVersionId: first.currentVersionId };
    expect((await request("other", `/quotes/${first.id}/versions`, "POST", input)).status).toBe(403);
    expect((await request("other", `/quotes/${first.id}`, "DELETE")).status).toBe(403);
    expect((await request("owner", `/quotes/${first.id}/restore`, "POST")).status).toBe(403);
    expect((await request("owner", "/quotes?showDeleted=true")).status).toBe(403);
    expect((await request("other", `/quotes/${first.id}`)).status).toBe(403);
  });

  it("ningún rol recibe snapshot ni margen; solo admin recibe la fecha de captura", async () => {
    for (const actor of ["owner", "admin"] as const) {
      for (const path of [`/quotes/${first.id}`, `/quotes/${first.id}/versions/${first.versionId}`]) {
        const result = await request(actor, path);
        expect(result.status).toBe(200);
        expect(JSON.stringify(result.body)).not.toMatch(/"configSnapshot"|"config_snapshot"|"margin"|"minimumMargins"/);
        if (actor === "admin") expect(result.body.config_snapshot_at).toBe(first.createdAt);
        else expect(result.body).not.toHaveProperty("config_snapshot_at");
      }
      const history = await request(actor, `/quotes/${first.id}/versions`);
      expect(JSON.stringify(history.body)).not.toMatch(/"configSnapshot"|"config_snapshot"|"margin"/);
      if (actor === "admin") expect(history.body.items[0].config_snapshot_at).toBe(first.createdAt);
      else expect(history.body.items[0]).not.toHaveProperty("config_snapshot_at");
    }
    const [stored] = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.id, first.versionId));
    expect(stored?.configSnapshot).toEqual(originalVersion.configSnapshot);
    expect(stored?.margin).toBe(originalVersion.margin);
  });

  it("el guardado administrativo normaliza la configuración y la base de datos conserva 2 % exactamente", async () => {
    const current = await getPricingConfig();
    const response = await request("admin", "/daas/config", "PUT", {
      ...current, monthlyPlacementRate: current.monthlyPlacementRate + Number.EPSILON,
      residuals: current.residuals.map(group => ({ ...group,
        assets: group.assets.map(asset => ({ ...asset, fraction: asset.fraction > 0 && asset.fraction < 1 ? asset.fraction + Number.EPSILON : asset.fraction })),
      })),
      margins: current.margins.map(item => ({ ...item, target: item.target + Number.EPSILON,
        minimum: item.minimum + Number.EPSILON, profitable: item.profitable + Number.EPSILON })),
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual(normalizePricingConfig(current));
    const [record] = await db.select().from(pricingConfigsTable).where(eq(pricingConfigsTable.id, "default"));
    expect(record?.config).toEqual(normalizePricingConfig(current));
    // Use an isolated config row to verify exact 2% storage without changing live business settings.
    const id = `precision-test-${token}`;
    try {
      await db.insert(pricingConfigsTable).values({ id, config: normalizePricingConfig({
        ...current, monthlyPlacementRate: percentToFraction("2"),
      }) });
      const [exact] = await db.select().from(pricingConfigsTable).where(eq(pricingConfigsTable.id, id));
      expect((exact?.config as typeof current).monthlyPlacementRate).toBe(0.02);
      expect(JSON.stringify((exact?.config as typeof current).monthlyPlacementRate)).toBe("0.02");
    } finally { await db.delete(pricingConfigsTable).where(eq(pricingConfigsTable.id, id)); }
    expect((await request("owner", "/daas/config/history")).status).toBe(403);
    expect((await request("admin", "/daas/config/history")).body.items).toBeInstanceOf(Array);
  });

  it("editar crea v2 y conserva v1 completa, sus resultados y su snapshot", async () => {
    editBody = { ...payload(`Quote fixture ${token} editada`), quoteCode: first.quoteCode, baseVersionId: first.currentVersionId,
      rows: [{ assetType: "Laptop", reference: "Referencia editada", quantity: 2, unitCost: 1500 }] };
    const edited = await request("owner", `/quotes/${first.id}/versions`, "POST", editBody);
    expect(edited.status).toBe(201);
    second = edited.body;
    expect(second.id).toBe(first.id);
    expect(second.versionNumber).toBe(2);
    expect(second.versionId).not.toBe(first.versionId);
    expect(second.currentVersionId).toBe(second.versionId);
    const [storedFirst] = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.id, first.versionId));
    expect(storedFirst).toEqual(originalVersion);
    expect(second.totalMonthlyBeforeTax).not.toBe(first.totalMonthlyBeforeTax);
    const old = await request("owner", `/quotes/${first.id}/versions/${first.versionId}`);
    expect(old.status).toBe(200);
    expect(old.body.versionNumber).toBe(1);
    expect(old.body.results).toEqual(first.results);
    expect(old.body.totalMonthlyBeforeTax).toBe(first.totalMonthlyBeforeTax);
    expect(JSON.stringify(old.body)).not.toMatch(/minimumMargins|"margin"/);
    const history = await request("owner", `/quotes/${first.id}/versions`);
    expect(history.body.items.map((version: any) => version.versionNumber)).toEqual([2, 1]);
    expect(history.body.items[0].createdByName).toBe(users.owner.name);
  });

  it("las repeticiones son idempotentes y los editores obsoletos reciben 409", async () => {
    const retry = await request("owner", `/quotes/${first.id}/versions`, "POST", editBody);
    expect(retry.status).toBe(201);
    expect(retry.body.versionId).toBe(second.versionId);
    expect((await request("owner", `/quotes/${first.id}/versions`, "POST", {
      ...editBody, customer: "Otro contenido",
    })).status).toBe(409);
    expect((await request("owner", `/quotes/${first.id}/versions`, "POST", {
      ...editBody, requestId: randomUUID(),
    })).status).toBe(409);
    const versions = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.quoteId, first.id));
    expect(versions).toHaveLength(2);
  });

  it("dos guardados concurrentes no sobrescriben ni repiten el número de versión", async () => {
    const base = { ...payload(), quoteCode: first.quoteCode, baseVersionId: second.currentVersionId };
    const responses = await Promise.all([
      request("owner", `/quotes/${first.id}/versions`, "POST", { ...base, customer: "Edición concurrente A" }),
      request("owner", `/quotes/${first.id}/versions`, "POST", { ...base, requestId: randomUUID(), customer: "Edición concurrente B" }),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    const versions = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.quoteId, first.id));
    expect(versions).toHaveLength(3);
    expect(new Set(versions.map(version => version.versionNumber)).size).toBe(3);
  });

  it("admin edita cualquier cotización y se conserva el propietario y el autor de cada versión", async () => {
    const current = await request("admin", `/quotes/${first.id}`);
    const edited = await request("admin", `/quotes/${first.id}/versions`, "POST", {
      ...payload(`Quote fixture ${token} admin`), quoteCode: first.quoteCode, baseVersionId: current.body.currentVersionId,
    });
    expect(edited.status).toBe(201);
    expect(edited.body.versionNumber).toBe(4);
    expect(edited.body.ownerId).toBe(users.owner.id);
    expect(edited.body.createdBy).toBe(users.admin.id);
    expect(edited.body.createdByName).toBe(users.admin.name);
    expect(JSON.stringify(edited.body)).not.toMatch(/minimumMargins|"margin"/);
  });

  it("borrado lógico oculta listado y búsqueda; admin muestra eliminadas y puede restaurar", async () => {
    expect((await request("owner", `/quotes/${first.id}`, "DELETE")).status).toBe(200);
    const [deleted] = await db.select().from(quotesTable).where(eq(quotesTable.id, first.id));
    expect(deleted?.deletedAt).toBeInstanceOf(Date);
    expect(deleted?.deletedBy).toBe(users.owner.id);
    expect((await request("owner", `/quotes?search=${token}`)).body.items.map((quote: any) => quote.id)).not.toContain(first.id);
    expect((await request("owner", `/quotes/${first.id}`)).status).toBe(404);
    expect((await request("admin", `/quotes?search=${token}`)).body.items.map((quote: any) => quote.id)).not.toContain(first.id);
    const all = await request("admin", `/quotes?search=${token}&showDeleted=true`);
    expect(all.body.items.map((quote: any) => quote.id)).toContain(first.id);
    expect(all.body.items.find((quote: any) => quote.id === first.id).deletedAt).toBeTruthy();
    expect((await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.quoteId, first.id)))).toHaveLength(4);
    expect((await request("admin", `/quotes/${first.id}/restore`, "POST")).status).toBe(200);
    expect((await request("owner", `/quotes?search=${token}`)).body.items.map((quote: any) => quote.id)).toContain(first.id);
    expect((await request("owner", `/quotes/${first.id}`)).status).toBe(200);
    expect((await request("admin", `/quotes/${first.id}`, "DELETE")).status).toBe(200);
    expect((await request("admin", `/quotes/${first.id}/restore`, "POST")).status).toBe(200);
  });

  it("duplicar crea una cotización independiente en v1", async () => {
    const copy = await request("owner", "/quotes", "POST", payload(`Copy fixture ${token}`));
    expect(copy.status).toBe(201);
    expect(copy.body.id).not.toBe(first.id);
    expect(copy.body.versionNumber).toBe(1);
    expect((await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.quoteId, first.id)))).toHaveLength(4);
  });

  it("migra exclusivamente Forecast desde los cánones guardados, lo lista y es idempotente", async () => {
    const created = await request("owner", "/quotes", "POST", payload());
    expect(created.status).toBe(201);
    const scenarios = [
      { termMonths: 48, totalMonthlyBeforeTax: "5543.27", results: created.body.results },
      { termMonths: 36, totalMonthlyBeforeTax: "6385.23", results: created.body.results },
    ];
    const [beforeVersion] = await db.update(quoteVersionsTable).set({
      scenarios, forecast: "6385.23", totalMonthlyBeforeTax: "6385.23",
    }).where(eq(quoteVersionsTable.id, created.body.versionId)).returning();
    const [beforeQuote] = await db.update(quotesTable).set({
      scenarios, forecast: "6385.23", totalMonthlyBeforeTax: "6385.23",
    }).where(eq(quotesTable.id, created.body.id)).returning();
    await migrateQuoteScenarios();
    const [afterVersion] = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.id, created.body.versionId));
    const [afterQuote] = await db.select().from(quotesTable).where(eq(quotesTable.id, created.body.id));
    expect(afterVersion).toEqual({ ...beforeVersion, forecast: "229868.28" });
    expect(afterQuote).toEqual({ ...beforeQuote, forecast: "229868.28" });
    expect((await request("owner", `/quotes/${created.body.id}`)).body.forecast).toBe("229868.28");
    const listed = await request("owner", "/quotes");
    expect(listed.body.items.find((item: any) => item.id === created.body.id).forecast).toBe("229868.28");
    await migrateQuoteScenarios();
    const [repeated] = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.id, created.body.versionId));
    expect(repeated).toEqual(afterVersion);
  });

  it("migra registros existentes como v1 sin recalcular y repetir la migración no crea versiones", async () => {
    const legacyConfig = clonePricingConfig(DEFAULT_PRICING_CONFIG);
    legacyConfig.monthlyPlacementRate = .018;
    const input = payload(`Legacy fixture ${token}`);
    const priced = priceQuote(input, legacyConfig);
    const { margins, individualServices: _catalog, ...oldFields } = legacyConfig;
    const legacySnapshot = {
      ...oldFields, spareBases: oldFields.spareBases.slice(0, 8),
      residuals: oldFields.residuals.map(group => ({ ...group, assets: group.assets.slice(0, 8) })),
      minimumMargins: margins.map(row => ({ termMonths: row.termMonths, fraction: row.target })),
    };
    const id = randomUUID();
    const originalDate = new Date("2025-06-01T08:30:00Z");
    await db.insert(quotesTable).values({
      id, ownerId: users.owner.id, requestId: input.requestId, customer: input.customer, quoteCode: input.quoteCode,
      termMonths: input.termMonths, packageType: input.packageType, margin: priced.margin,
      rows: input.rows, results: priced.results, totalMonthlyBeforeTax: priced.totalMonthlyBeforeTax,
      configSnapshot: legacySnapshot, createdAt: originalDate,
    });
    await ensureQuoteVersionMigration();
    await ensureQuoteVersionMigration();
    const records = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.quoteId, id));
    expect(records).toHaveLength(1);
    expect(records[0]?.versionNumber).toBe(1);
    expect(records[0]?.createdAt).toEqual(originalDate);
    expect(records[0]?.createdBy).toBe(users.owner.id);
    expect(records[0]?.results).toEqual(priced.results);
    expect(records[0]?.configSnapshot).toEqual(legacySnapshot);
    expect(records[0]?.deliveryStatus).toBe("");
    expect(records[0]?.scenarios).toEqual([{ termMonths: input.termMonths, results: priced.results, totalMonthlyBeforeTax: priced.totalMonthlyBeforeTax }]);
    const legacyRead = await request("owner", `/quotes/${id}`);
    expect(legacyRead.status).toBe(200);
    expect(legacyRead.body.deliveryStatus).toBe("");
    expect(legacyRead.body.terms).toEqual([36]);
    expect(legacyRead.body.totalMonthlyBeforeTax).toBe(priced.totalMonthlyBeforeTax);
    expect(records[0]?.totalMonthlyBeforeTax).toBe(priced.totalMonthlyBeforeTax);
    const [parent] = await db.select().from(quotesTable).where(eq(quotesTable.id, id));
    expect(parent?.currentVersionId).toBe(records[0]?.id);
    const revised = await request("owner", `/quotes/${id}/versions`, "POST", {
      ...input, requestId: randomUUID(), baseVersionId: records[0]!.id,
    });
    expect(revised.status).toBe(201);
    expect(revised.body.versionNumber).toBe(2);
    const [newVersion] = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.id, revised.body.versionId));
    expect((newVersion?.configSnapshot as typeof config).monthlyPlacementRate).toBe(config.monthlyPlacementRate);
    const [preserved] = await db.select().from(quoteVersionsTable)
      .where(and(eq(quoteVersionsTable.quoteId, id), eq(quoteVersionsTable.versionNumber, 1)));
    expect(preserved).toEqual(records[0]);
  });

  it("Objetivo inferior al Mínimo bloquea preview y guardado con 422 genérico", async () => {
    const current = await getPricingConfig();
    const invalid = clonePricingConfig(current);
    invalid.margins.find(row => row.termMonths === 36)!.target = .01;
    try {
      await db.update(pricingConfigsTable).set({ config: invalid }).where(eq(pricingConfigsTable.id, "default"));
      const input = payload();
      const preview = await request("owner", "/quotes/preview", "POST", {
        termMonths: input.termMonths, packageType: input.packageType, rows: input.rows, deliveryStatus: input.deliveryStatus,
      });
      const save = await request("owner", "/quotes", "POST", {
        ...input, expectedRevision: quoteConfigRevision(invalid),
      });
      const staleSave = await request("owner", "/quotes", "POST", {
        ...input, requestId: randomUUID(), expectedRevision: quoteConfigRevision(current),
      });
      for (const response of [preview, save, staleSave]) {
        expect(response.status).toBe(422);
        expect(response.body).toEqual({ error: QUOTE_UNAVAILABLE });
        expect(JSON.stringify(response.body)).not.toMatch(/margen|margin|target|minimum/i);
      }
    } finally {
      await db.update(pricingConfigsTable).set({ config: current }).where(eq(pricingConfigsTable.id, "default"));
    }
  });

  it("solo admin modifica servicios; desactivar conserva registros y snapshots", async () => {
    const current = await getPricingConfig();
    const revised = clonePricingConfig(current);
    revised.individualServices[0] = {
      ...revised.individualServices[0]!, active: false, name: "Etiquetado de prueba",
      unitCost: 4, unit: "Por evento", mandatory: false,
    };
    expect((await request("owner", "/daas/config", "PUT", revised)).status).toBe(403);
    const invalid = clonePricingConfig(current);
    invalid.margins[0]!.target = 0;
    expect((await request("admin", "/daas/config", "PUT", invalid)).status).toBe(400);
    const missing = clonePricingConfig(current);
    missing.individualServices.shift();
    expect((await request("admin", "/daas/config", "PUT", missing)).status).toBe(400);
    try {
      const saved = await request("admin", "/daas/config", "PUT", revised);
      expect(saved.status).toBe(200);
      expect(saved.body.individualServices).toEqual(revised.individualServices);
      expect((await request("admin", "/daas/config")).body.individualServices).toEqual(revised.individualServices);
      const [historical] = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.id, first.versionId));
      expect(historical).toEqual(originalVersion);
      const catalog = await request("owner", "/daas/catalog");
      expect(catalog.body.assetTypes).toHaveLength(11);
      expect(catalog.body.individualServices.every((row: any) => row.active)).toBe(true);
      expect(JSON.stringify(catalog.body)).not.toMatch(/"margins"|"minimum"|"target"|"profitable"/);
    } finally {
      expect((await request("admin", "/daas/config", "PUT", current)).status).toBe(200);
    }
  });

  it("guarda el esquema individual y extras por versión, restaura sin recalcular y reintenta sin duplicar", async () => {
    const current = await getPricingConfig();
    const input = {
      ...payload(`Servicios fixture ${token}`), expectedRevision: quoteConfigRevision(current),
      serviceMode: "Servicios individuales", packageType: null,
      rows: [
        { assetType: "HW Seguridad", reference: "Firewall", quantity: 2, unitCost: 500 },
        { assetType: "Equipos POS", reference: "POS", quantity: 3, unitCost: 200 },
        { assetType: "Licenciamiento", reference: "Licencia", quantity: 4, unitCost: 50 },
      ],
      selectedServices: [{ id: "creacion-imagen", quantity: 2 }],
      customServices: [{ id: randomUUID(), name: "Soporte anual especial", unitCost: 55, unit: "Por año" }],
    };
    const preview = await request("owner", "/quotes/preview", "POST", input);
    expect(preview.status).toBe(200);
    expect(preview.body.includedServices.some((row: any) => row.name === "Etiquetado")).toBe(true);
    const result = await request("owner", "/quotes", "POST", input);
    expect(result.status).toBe(201);
    expect(result.body.serviceMode).toBe("Servicios individuales");
    expect(result.body.packageType).toBeNull();
    expect(result.body.selectedServices).toEqual(input.selectedServices);
    expect(result.body.customServices).toEqual(input.customServices);
    expect(result.body.totalMonthlyBeforeTax).toBe(preview.body.totalMonthlyBeforeTax);
    const retry = await request("owner", "/quotes", "POST", input);
    expect(retry.status).toBe(201);
    expect(retry.body.versionId).toBe(result.body.versionId);
    expect((await request("owner", "/quotes", "POST", { ...input, selectedServices: [] })).status).toBe(409);
    expect((await request("owner", `/quotes/${result.body.id}`)).body).toEqual(result.body);
    const next = await request("owner", `/quotes/${result.body.id}/versions`, "POST", {
      ...input, requestId: randomUUID(), baseVersionId: result.body.versionId,
      serviceMode: "Paquete", packageType: "Premium", selectedServices: [],
      customServices: [{ id: randomUUID(), name: "Instalación especial", unitCost: 80, unit: "Por evento", quantity: 2 }],
    });
    expect(next.status).toBe(201);
    expect(next.body.versionNumber).toBe(2);
    expect(next.body.includedServices).toHaveLength(2);
    const historical = await request("owner", `/quotes/${result.body.id}/versions/${result.body.versionId}`);
    expect(historical.body.includedServices).toEqual(result.body.includedServices);
    expect(historical.body.totalMonthlyBeforeTax).toBe(result.body.totalMonthlyBeforeTax);
    const [stored] = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.id, result.body.versionId));
    expect(stored?.serviceSelection).toMatchObject({
      serviceMode: input.serviceMode, selectedServices: input.selectedServices, customServices: input.customServices,
    });
  });

  it("la API no permite omitir cantidades de servicios por perfil ni aceptar extras de costo cero", async () => {
    const input = { ...payload(), serviceMode: "Servicios individuales", packageType: null };
    for (const bad of [
      { selectedServices: [{ id: "creacion-imagen" }] },
      { customServices: [{ id: randomUUID(), name: "Extra", unitCost: 0, unit: "Por equipo" }] },
      { customServices: [{ id: randomUUID(), name: "Extra", unitCost: 10, unit: "Por evento", quantity: 1.5 }] },
    ]) {
      expect((await request("owner", "/quotes/preview", "POST", { ...input, ...bad })).status).toBe(400);
      expect((await request("owner", "/quotes", "POST", { ...input, ...bad, requestId: randomUUID() })).status).toBe(400);
    }
  });

  it("persiste múltiples escenarios y extensiones por versión sin modificar versiones anteriores", async () => {
    const current = await getPricingConfig();
    const input = {
      ...payload(`Escenarios fixture ${token}`), expectedRevision: quoteConfigRevision(current),
      termMonths: 24, terms: [24, 36, 60], deliveryStatus: "CTO",
      rows: [{ assetType: "Laptop", reference: "Laptop escenarios", quantity: 3, unitCost: 900,
        warrantyExtensions: [{ termMonths: 36, unitCost: 0 }, { termMonths: 60, unitCost: 150 }] }],
    };
    const preview = await request("owner", "/quotes/preview", "POST", input);
    expect(preview.status).toBe(200);
    expect(preview.body.scenarios.map((scenario: any) => scenario.termMonths)).toEqual([24, 36, 60]);
    const saved = await request("owner", "/quotes", "POST", input);
    expect(saved.status).toBe(201);
    expect(saved.body.scenarios).toEqual(preview.body.scenarios);
    expect(saved.body.deliveryStatus).toBe("CTO");
    expect(saved.body.rows).toEqual(input.rows);
    expect((await request("owner", `/quotes/${saved.body.id}`)).body).toEqual(saved.body);
    expect((await request("owner", "/quotes", "POST", input)).body.versionId).toBe(saved.body.versionId);
    expect((await request("owner", "/quotes", "POST", { ...input, deliveryStatus: "Local" })).status).toBe(409);
    const edited = await request("owner", `/quotes/${saved.body.id}/versions`, "POST", {
      ...input, requestId: randomUUID(), baseVersionId: saved.body.versionId, terms: [24, 36], deliveryStatus: "Local",
    });
    expect(edited.status).toBe(201);
    expect(edited.body.terms).toEqual([24, 36]);
    expect(edited.body.deliveryStatus).toBe("Local");
    const historical = await request("owner", `/quotes/${saved.body.id}/versions/${saved.body.versionId}`);
    expect(historical.body.scenarios).toEqual(saved.body.scenarios);
    expect(historical.body.rows).toEqual(saved.body.rows);
    expect(historical.body.deliveryStatus).toBe("CTO");
    expect(JSON.stringify(historical.body)).not.toMatch(/"margin"|"configSnapshot"|"minimum"|"target"/);
  });

  it("preview y guardado exigen estado y cada extensión, aceptando cero explícito", async () => {
    const base = { ...payload(), termMonths: 12, terms: [12, 24] };
    for (const path of ["/quotes/preview", "/quotes"]) {
      const missing = await request("owner", path, "POST", base);
      expect(missing.status).toBe(400);
      expect(missing.body.error).toBe("Indique el costo de extensión de garantía a 24 meses para Referencia de prueba.");
      const invalidStatus = await request("owner", path, "POST", {
        ...base, deliveryStatus: "", rows: base.rows.map(row => ({ ...row, warrantyExtensions: [{ termMonths: 24, unitCost: 0 }] })),
      });
      expect(invalidStatus.status).toBe(400);
    }
  });

  it("renumera por fecha, conserva contenido, corrige actual y mantiene el nombre histórico del autor", async () => {
    const created = await request("owner", "/quotes", "POST", payload(`Numeración fixture ${token}`));
    expect(created.status).toBe(201);
    const quoteId = created.body.id;
    const [base] = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.quoteId, quoteId));
    const oldDate = new Date("2024-01-02T09:31:00-05:00");
    const middleDate = new Date("2024-02-02T10:32:00+01:00");
    const latestDate = new Date("2024-03-02T11:33:00+00:00");
    await db.update(quoteVersionsTable).set({ versionNumber: 14, createdAt: oldDate, createdByName: "" })
      .where(eq(quoteVersionsTable.id, base!.id));
    const [middle] = await db.insert(quoteVersionsTable).values({
      ...base!, id: randomUUID(), requestId: randomUUID(), versionNumber: 3, createdAt: middleDate,
      createdByName: users.owner.name, customer: "Contenido intermedio intacto",
    }).returning();
    const [latest] = await db.insert(quoteVersionsTable).values({
      ...base!, id: randomUUID(), requestId: randomUUID(), versionNumber: 8, createdAt: latestDate,
      createdByName: users.owner.name, customer: "Contenido reciente intacto",
    }).returning();
    await db.update(quotesTable).set({ currentVersionId: middle!.id }).where(eq(quotesTable.id, quoteId));
    const before = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.quoteId, quoteId));
    await migrateQuoteVersionNumbers();
    const after = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.quoteId, quoteId));
    for (const version of after) {
      const previous = before.find(row => row.id === version.id)!;
      expect({ ...version, versionNumber: previous.versionNumber, createdByName: previous.createdByName }).toEqual(previous);
    }
    const history = await request("owner", `/quotes/${quoteId}/versions`);
    expect(history.body.items.map((row: any) => [row.id, row.versionNumber])).toEqual([
      [latest!.id, 3], [middle!.id, 2], [base!.id, 1],
    ]);
    expect(history.body.currentVersionId).toBe(latest!.id);
    expect(history.body.items[2].createdAt).toBe(oldDate.toISOString());
    expect(history.body.items[0].createdBy).toBe(users.owner.id);
    expect(history.body.items[0].createdByName).toBe(users.owner.name);
    await migrateQuoteVersionNumbers();
    const again = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.quoteId, quoteId));
    expect(again.sort((a, b) => a.versionNumber - b.versionNumber)).toEqual(after.sort((a, b) => a.versionNumber - b.versionNumber));
    await expect(db.insert(quoteVersionsTable).values({
      ...latest!, id: randomUUID(), requestId: randomUUID(), versionNumber: 3,
    })).rejects.toThrow();
    await db.update(appUsersTable).set({ name: "Nombre modificado después de guardar" }).where(eq(appUsersTable.id, users.owner.id));
    try {
      const detail = await request("owner", `/quotes/${quoteId}`);
      expect(detail.body.createdByName).toBe(users.owner.name);
      const renamedHistory = await request("owner", `/quotes/${quoteId}/versions`);
      expect(renamedHistory.body.items.every((row: any) => row.createdByName === users.owner.name)).toBe(true);
    } finally {
      await db.update(appUsersTable).set({ name: users.owner.name }).where(eq(appUsersTable.id, users.owner.id));
    }
  });

  it("asigna max + 1 dentro de la transacción aunque el puntero actual no tenga el número máximo", async () => {
    const created = await request("owner", "/quotes", "POST", payload(`Máximo fixture ${token}`));
    const [base] = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.quoteId, created.body.id));
    await db.insert(quoteVersionsTable).values({
      ...base!, id: randomUUID(), requestId: randomUUID(), versionNumber: 9,
    });
    const next = await request("owner", `/quotes/${created.body.id}/versions`, "POST", {
      ...payload(), baseVersionId: base!.id,
    });
    expect(next.status).toBe(201);
    expect(next.body.versionNumber).toBe(10);
    expect(next.body.createdBy).toBe(users.owner.id);
    expect(next.body.createdByName).toBe(users.owner.name);
    expect(next.body.createdAt).toMatch(/T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const copy = await request("owner", "/quotes", "POST", payload(`Duplicado desde v10 ${token}`));
    expect(copy.status).toBe(201);
    expect(copy.body.versionNumber).toBe(1);
    expect(copy.body.id).not.toBe(created.body.id);
  });
});
