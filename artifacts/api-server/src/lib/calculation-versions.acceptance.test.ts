import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { calculationConfig, commonRows } from "../test/fixtures/calculation-config";

// Keep PostgreSQL transactions, constraints, timestamps and quote persistence
// real. Substitute ONLY the pricing-settings read inside saveVersion.
// No test reads or overwrites the application's saved pricing configuration.
vi.mock("@workspace/db", async importOriginal => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...original,
    db: new Proxy(original.db, {
      get(target, key) {
        if (key === "transaction") {
          return (callback: Parameters<typeof original.db.transaction>[0]) =>
            target.transaction(tx => callback(new Proxy(tx, {
              get(transaction, property) {
                if (property === "select") return (...args: Parameters<typeof tx.select>) => ({
                  from(table: unknown) {
                    if (table === original.pricingConfigsTable) {
                      const settings = {
                        where: () => settings, for: () => settings,
                        limit: async () => [{ config: fixedConfig }],
                      };
                      return settings;
                    }
                    return transaction.select(...args).from(table as typeof original.quotesTable);
                  },
                });
                const value = Reflect.get(transaction, property);
                return typeof value === "function" ? value.bind(transaction) : value;
              },
            })));
        }
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
  };
});

import { db, pool, appUsersTable, quotesTable, quoteVersionsTable, type AppUserRecord } from "@workspace/db";
import { saveVersion } from "./quote-storage";
import { quoteConfigRevision } from "./quote-pricing";
import express from "express";
import type { Server } from "node:http";
import quotesRouter from "../routes/quotes";
import { publicScenarios } from "./business-profitability";

let fixedConfig = calculationConfig();
vi.mock("./pricing-config", () => ({
  getPricingConfig: async () => fixedConfig,
}));

describe("Aceptación D: crear y editar dos veces usando configuración fija", () => {
  const actor: AppUserRecord = {
    id: `calculation-versions-${randomUUID()}`, name: "Autor de aceptación",
    email: `acceptance-${randomUUID()}@example.invalid`, role: "comercial", createdAt: new Date(), isBlocked: false, lastAccessAt: null,
  };
  let quoteId: string | undefined;
  afterAll(async () => {
    if (quoteId) {
      await db.update(quotesTable).set({ currentVersionId: null }).where(eq(quotesTable.id, quoteId));
      await db.delete(quoteVersionsTable).where(eq(quoteVersionsTable.quoteId, quoteId));
      await db.delete(quotesTable).where(eq(quotesTable.id, quoteId));
    }
    await db.delete(appUsersTable).where(eq(appUsersTable.id, actor.id));
    await pool.end();
  });
  it("produce 1, 2, 3 cronológicas, con autor y fecha/hora persistidos, y sin alterar v1", async () => {
    await db.insert(appUsersTable).values(actor);
    const input = {
      requestId: randomUUID(), customer: "Aceptación D", quoteCode: `ACEPTACION-${randomUUID()}`, termMonths: 36 as const,
      terms: [36, 60] as Array<36 | 60>, packageType: null, serviceMode: "Servicios individuales" as const,
      selectedServices: [
        { id: "mantenimiento-preventivo", events: [{ termMonths: 12 as const, quantity: 1 }, { termMonths: 36 as const, quantity: 3 }, { termMonths: 60 as const, quantity: 5 }] },
        { id: "logistica-salientes", quantity: 30 },
      ],
      deliveryStatus: "Local" as const, rows: commonRows(),
      expectedRevision: quoteConfigRevision(calculationConfig()),
    };
    const first = await saveVersion(actor, input);
    quoteId = first.id;
    const second = await saveVersion(actor, {
      ...input, requestId: randomUUID(), customer: "Primera edición", baseVersionId: first.versionId,
    }, quoteId);
    const third = await saveVersion(actor, {
      ...input, requestId: randomUUID(), customer: "Segunda edición", baseVersionId: second.versionId,
    }, quoteId);
    expect([first.versionNumber, second.versionNumber, third.versionNumber]).toEqual([1, 2, 3]);
    const stored = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.quoteId, quoteId)).orderBy(quoteVersionsTable.createdAt, quoteVersionsTable.versionNumber);
    expect(stored.map(row => row.versionNumber)).toEqual([1, 2, 3]);
    expect(stored.map(row => row.customer)).toEqual(["Aceptación D", "Primera edición", "Segunda edición"]);
    for (const row of stored) {
      expect(row.createdBy).toBe(actor.id);
      expect(row.createdByName).toBe(actor.name);
      expect(row.createdAt.toISOString()).toMatch(/T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(row.configSnapshot).toEqual(calculationConfig());
      expect(row.results).toEqual(first.results);
      expect(publicScenarios(row.scenarios as Parameters<typeof publicScenarios>[0], false)).toEqual(first.scenarios);
      expect(row.forecast).toBe(first.forecast);
      expect(Number(row.forecast)).toBeCloseTo(4668.18 * 36, 1);
      expect(row.serviceSelection).toMatchObject({ serviceMode: "Servicios individuales", selectedServices: input.selectedServices });
    }
    const [parent] = await db.select().from(quotesTable).where(eq(quotesTable.id, quoteId));
    expect(parent!.currentVersionId).toBe(third.versionId);
  });

  it("API: 12 bloquea con 422, retirarlo permite guardar; privacidad y filtro administrativo", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      res.locals.appUser = { ...actor, role: req.headers["x-admin"] === "true" ? "admin" : "comercial" };
      req.log = { error: () => undefined } as unknown as typeof req.log;
      next();
    });
    app.use(quotesRouter);
    const server: Server = await new Promise(resolve => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server unavailable");
    const call = async (path: string, body?: unknown, admin = false) => {
      const r = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", "x-admin": String(admin) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: r.status, body: await r.json() as any };
    };
    const createdIds: string[] = [];
    try {
      const input = {
        requestId: randomUUID(), customer: "Rentabilidad aceptación", quoteCode: `PYG-${randomUUID()}`,
        termMonths: 12, terms: [12, 24], packageType: null, serviceMode: "Servicios individuales",
        selectedServices: [], deliveryStatus: "Local", expectedRevision: quoteConfigRevision(fixedConfig),
        rows: [{ assetType: "Laptop", reference: "E14", quantity: 100, unitCost: 1500,
          warrantyExtensions: [{ termMonths: 24, unitCost: 0 }] }],
      };
      const blocked = await call("/quotes", input);
      expect(blocked).toEqual({ status: 422, body: {
        error: "El escenario de 12 meses no cumple las condiciones comerciales. Retírelo o contacte con un administrador.",
      } });
      const preview = await call("/quotes/preview", input);
      expect(preview.status).toBe(200);
      expect(preview.body.blockingErrors).toHaveLength(1);
      expect(JSON.stringify(preview.body)).not.toMatch(/profitability|commercialMargin|netMargin|netProfit|"status"/);
      const allowed = await call("/quotes", { ...input, termMonths: 24, terms: [24] });
      expect(allowed.status).toBe(201);
      createdIds.push(allowed.body.id);
      const versionId = allowed.body.versionId;
      const commercial = await call(`/quotes/${allowed.body.id}`);
      expect(JSON.stringify(commercial.body)).not.toMatch(/profitability|commercialMargin|netMargin|netProfit|"status"/);
      const admin = await call(`/quotes/${allowed.body.id}`, undefined, true);
      expect(admin.body.scenarios[0].profitability).toMatchObject({ commercialMargin: .05, status: "En objetivo" });
      const storedProfitability = admin.body.scenarios[0].profitability;
      fixedConfig.margins.find(m => m.termMonths === 24)!.target = .16;
      const low = await call("/quotes", { ...input, requestId: randomUUID(), quoteCode: `LOW-${randomUUID()}`, termMonths: 24, terms: [24],
        expectedRevision: quoteConfigRevision(fixedConfig) }, true);
      expect(low.status).toBe(201);
      createdIds.push(low.body.id);
      expect(low.body.scenarios[0].profitability.status).toBe("Bajo objetivo");
      expect((await call("/quotes?belowTarget=true")).status).toBe(403);
      const filtered = await call("/quotes?belowTarget=true", undefined, true);
      expect(filtered.status).toBe(200);
      expect(filtered.body.items.some((q: any) => q.id === low.body.id)).toBe(true);
      expect(filtered.body.items.some((q: any) => q.id === allowed.body.id)).toBe(false);
      // Today's changed thresholds must not reclassify an old version.
      const historic = await call(`/quotes/${allowed.body.id}/versions/${versionId}`, undefined, true);
      expect(historic.body.scenarios[0].profitability).toEqual(storedProfitability);
      const [stored] = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.id, versionId));
      expect((stored!.scenarios as any[])[0].profitability).toEqual(storedProfitability);
      fixedConfig.monthlyFundingRate = .008;
      const fundedInput = { ...input, requestId: randomUUID(), quoteCode: `FUNDED-${randomUUID()}`, termMonths: 36, terms: [36],
        expectedRevision: quoteConfigRevision(fixedConfig) };
      const fundedPreview = await call("/quotes/preview", fundedInput, true);
      expect(fundedPreview.status).toBe(200);
      expect(fundedPreview.body.scenarios[0].profitability).toMatchObject({
        monthlyFundingRate: .008, status: "Bajo mínimo",
      });
      expect(fundedPreview.body.blockingErrors).toHaveLength(1);
      expect((await call("/quotes", fundedInput)).status).toBe(422);
      const commercialPreview = await call("/quotes/preview", fundedInput);
      expect(JSON.stringify(commercialPreview.body)).not.toMatch(/monthlyFundingRate|fundingInterest|operatingProfit/);
      fixedConfig.monthlyFundingRate = .001;
      const fundedSaved = await call("/quotes", { ...fundedInput, requestId: randomUUID(),
        expectedRevision: quoteConfigRevision(fixedConfig) }, true);
      expect(fundedSaved.status).toBe(201);
      createdIds.push(fundedSaved.body.id);
      const fundedRead = await call(`/quotes/${fundedSaved.body.id}`, undefined, true);
      expect(fundedRead.body.scenarios[0].profitability).toEqual(fundedSaved.body.scenarios[0].profitability);
      expect(fundedRead.body.scenarios[0].profitability.monthlyFundingRate).toBe(.001);
      expect(Number(fundedRead.body.scenarios[0].profitability.fundingInterest)).toBeGreaterThan(0);
      expect(JSON.stringify((await call(`/quotes/${fundedSaved.body.id}`)).body))
        .not.toMatch(/monthlyFundingRate|fundingInterest|operatingProfit/);
      // A later funding-rate change must not re-evaluate a saved version.
      fixedConfig.monthlyFundingRate = .01;
      expect((await call(`/quotes/${fundedSaved.body.id}`, undefined, true)).body.scenarios)
        .toEqual(fundedRead.body.scenarios);
    } finally {
      fixedConfig = calculationConfig();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      for (const id of createdIds) {
        await db.update(quotesTable).set({ currentVersionId: null }).where(eq(quotesTable.id, id));
        await db.delete(quoteVersionsTable).where(eq(quoteVersionsTable.quoteId, id));
        await db.delete(quotesTable).where(eq(quotesTable.id, id));
      }
    }
  });
});
