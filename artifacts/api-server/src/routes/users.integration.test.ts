import express from "express";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { calculationConfig } from "../test/fixtures/calculation-config";

vi.mock("@clerk/express", () => ({
  getAuth: (req: any) => ({ userId: req.headers["x-test-user"] }),
  clerkClient: { users: { getUser: async (id: string) => ({
    firstName: "Cuenta", lastName: "de prueba", primaryEmailAddressId: "primary",
    emailAddresses: [{ id: "primary", emailAddress: `${id}@example.invalid`, verification: { status: "verified" } }],
  }) } },
}));
vi.mock("../lib/pricing-config", () => ({
  getPricingConfig: async () => calculationConfig(), ensurePricingMigration: async () => undefined,
}));
// Only the pricing-settings read is substituted; user/quote data and all
// permissions, locks, history and transactions use real PostgreSQL.
vi.mock("@workspace/db", async importOriginal => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return { ...original, db: new Proxy(original.db, {
    get(target, key) {
      if (key !== "transaction") return Reflect.get(target, key);
      return (run: any) => target.transaction(tx => run(new Proxy(tx, {
        get(transaction, property) {
          if (property !== "select") return Reflect.get(transaction, property);
          return (...args: any[]) => {
            const builder = (transaction.select as any)(...args);
            return new Proxy(builder, { get(query, part) {
              if (part !== "from") return Reflect.get(query, part);
              return (table: unknown) => table === original.pricingConfigsTable
                ? { where: () => ({ for: () => ({ limit: async () => [{ config: calculationConfig() }] }) }) }
                : query.from(table);
            } });
          };
        },
      })));
    },
  }) };
});

import { db, pool, appUsersTable, quotesTable, quoteVersionsTable, userRoleHistoryTable } from "@workspace/db";
import { requireUser } from "../middlewares/app-auth";
import { requireRole, APP_ROLES, BLOCKED_ACCESS_MESSAGE } from "../middlewares/require-role";
import usersRouter from "./users";
import quotesRouter from "./quotes";
import daasRouter from "./daas";
import { quoteConfigRevision } from "../lib/quote-pricing";
import { provisionAccount } from "../lib/app-accounts";

describe("Usuarios, permisos y acceso bloqueado: PostgreSQL y middleware real", () => {
  const token = randomUUID();
  const users = {
    admin: { id: `rbac-admin-${token}`, role: "admin" as const },
    secondAdmin: { id: `rbac-admin2-${token}`, role: "admin" as const },
    manager: { id: `rbac-manager-${token}`, role: "gerente_comercial" as const },
    source: { id: `rbac-source-${token}`, role: "comercial" as const },
    target: { id: `rbac-target-${token}`, role: "comercial" as const },
  };
  const ids = Object.values(users).map(u => u.id);
  let server: Server, url: string, quote: any, secondQuote: any;
  const input = () => ({
    requestId: randomUUID(), customer: `RBAC ${token}`, quoteCode: `ID-${randomUUID()}`,
    termMonths: 36, terms: [36], deliveryStatus: "Local", packageType: null,
    serviceMode: "Servicios individuales", selectedServices: [], customServices: [],
    rows: [{ assetType: "Laptop", reference: "E14", quantity: 100, unitCost: 1500 }],
    expectedRevision: quoteConfigRevision(calculationConfig()),
  });
  async function call(actor: keyof typeof users, path: string, method = "GET", body?: unknown) {
    const response = await fetch(`${url}${path}`, { method,
      headers: { "Content-Type": "application/json", "x-test-user": users[actor].id },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() as any };
  }
  beforeAll(async () => {
    await db.insert(appUsersTable).values(Object.values(users).map(u => ({
      ...u, name: `Prueba ${u.role}`, email: `${u.id}@example.invalid`,
    })));
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.log = { error: console.error, warn: () => undefined } as any; next(); });
    app.use(requireUser, requireRole(...APP_ROLES), usersRouter, quotesRouter, daasRouter);
    server = await new Promise(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server unavailable");
    url = `http://127.0.0.1:${address.port}`;
    const first = await call("source", "/quotes", "POST", input());
    expect(first.status).toBe(201); quote = first.body;
    const second = await call("source", "/quotes", "POST", input());
    expect(second.status).toBe(201); secondQuote = second.body;
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    const rows = await db.select({ id: quotesTable.id }).from(quotesTable).where(inArray(quotesTable.ownerId, ids));
    const quoteIds = rows.map(q => q.id);
    if (quoteIds.length) {
      await db.update(quotesTable).set({ currentVersionId: null }).where(inArray(quotesTable.id, quoteIds));
      await db.delete(quoteVersionsTable).where(inArray(quoteVersionsTable.quoteId, quoteIds));
      await db.delete(quotesTable).where(inArray(quotesTable.id, quoteIds));
    }
    await db.delete(userRoleHistoryTable).where(inArray(userRoleHistoryTable.changedBy, ids));
    await db.delete(appUsersTable).where(inArray(appUsersTable.id, ids));
    await pool.end();
  });
  it("comercial recibe 403 en Usuarios, Parámetros y cotizaciones ajenas", async () => {
    expect((await call("source", "/usuarios")).status).toBe(403);
    expect((await call("source", "/daas/config")).status).toBe(403);
    expect((await call("target", `/quotes/${quote.id}`)).status).toBe(403);
    expect((await call("target", `/quotes/${quote.id}`, "DELETE")).status).toBe(403);
    expect((await call("source", `/quotes/${quote.id}`)).body.scenarios[0].profitability).toBeUndefined();
  });
  it("gerente ve, edita y duplica cotizaciones ajenas, con P&G pero sin administración ni restauración", async () => {
    const read = await call("manager", `/quotes/${quote.id}`);
    expect(read.status).toBe(200);
    expect(read.body.scenarios[0].profitability.netMargin).toBeGreaterThan(0);
    const edited = await call("manager", `/quotes/${quote.id}/versions`, "POST",
      { ...input(), baseVersionId: read.body.versionId, customer: `Editada ${token}` });
    expect(edited.status).toBe(201);
    expect(edited.body.versionNumber).toBe(2);
    const duplicated = await call("manager", "/quotes", "POST", { ...input(), customer: `Duplicada ${token}` });
    expect(duplicated.status).toBe(201);
    expect(duplicated.body.ownerId).toBe(users.manager.id);
    expect((await call("manager", "/quotes?belowTarget=true")).status).toBe(200);
    expect((await call("manager", "/usuarios")).status).toBe(403);
    expect((await call("manager", "/daas/config")).status).toBe(403);
    expect((await call("manager", `/quotes/${quote.id}/restore`, "POST")).status).toBe(403);
    expect((await call("manager", `/quotes/${quote.id}`, "DELETE")).status).toBe(403);
  });
  it("protege cambios propios y audita cada cambio real de rol", async () => {
    expect((await call("admin", `/usuarios/${users.admin.id}`, "PATCH", { action: "role_change", role: "comercial" })).status).toBe(403);
    expect((await call("admin", `/usuarios/${users.admin.id}`, "PATCH", { action: "block" })).status).toBe(403);
    const changed = await call("admin", `/usuarios/${users.target.id}`, "PATCH", { action: "role_change", role: "gerente_comercial" });
    expect(changed.status).toBe(200);
    // Role changes are applied on the very next authenticated request.
    expect((await call("target", `/quotes/${quote.id}`)).status).toBe(200);
    const history = await call("admin", `/usuarios/${users.target.id}/historial`);
    expect(history.body.items[0]).toMatchObject({ action: "role_change", changedBy: users.admin.id,
      previousValue: "comercial", newValue: "gerente_comercial" });
    // Identity refresh and INITIAL_ADMIN_EMAIL do not overwrite an existing role.
    await provisionAccount(users.target.id, `${users.target.id}@example.invalid`, "Destino", `${users.target.id}@example.invalid`);
    const [target] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, users.target.id));
    expect(target!.role).toBe("gerente_comercial");
  });
  it("bloquea la siguiente petición, conserva cotizaciones y marca su creador bloqueado", async () => {
    expect((await call("source", "/auth/me")).status).toBe(200);
    expect((await call("admin", `/usuarios/${users.source.id}`, "PATCH", { action: "block" })).status).toBe(200);
    const blocked = await call("source", "/quotes");
    expect(blocked).toEqual({ status: 403, body: { error: BLOCKED_ACCESS_MESSAGE } });
    expect((await call("source", "/auth/me")).status).toBe(403);
    const read = await call("manager", `/quotes/${secondQuote.id}`);
    expect(read.status).toBe(200);
    expect(read.body.ownerId).toBe(users.source.id);
    expect(read.body.createdByBlocked).toBe(true);
    const list = await call("admin", `/quotes?search=${encodeURIComponent(`RBAC ${token}`)}`);
    expect(list.body.items.find((q: any) => q.id === secondQuote.id).createdByBlocked).toBe(true);
    expect((await call("admin", `/usuarios/${users.source.id}/historial`)).body.items[0].action).toBe("block");
  });
  it("reasigna todas las cotizaciones, incluso eliminadas, sin cambiar versiones, y lo audita", async () => {
    await db.update(quotesTable).set({ deletedAt: new Date() }).where(eq(quotesTable.id, secondQuote.id));
    const before = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.quoteId, secondQuote.id));
    const transferred = await call("admin", `/usuarios/${users.source.id}/reasignar`, "POST", { targetUserId: users.target.id });
    expect(transferred).toEqual({ status: 200, body: { success: true, transferredCount: 2 } });
    const remaining = await db.select().from(quotesTable).where(eq(quotesTable.ownerId, users.source.id));
    expect(remaining).toHaveLength(0);
    const owned = await db.select().from(quotesTable).where(eq(quotesTable.ownerId, users.target.id));
    expect(owned.map(q => q.id)).toEqual(expect.arrayContaining([quote.id, secondQuote.id]));
    expect(await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.quoteId, secondQuote.id))).toEqual(before);
    const history = await call("admin", `/usuarios/${users.source.id}/historial`);
    expect(history.body.items[0]).toMatchObject({ action: "reassign",
      previousValue: { ownerId: users.source.id, quoteCount: 2 }, newValue: { ownerId: users.target.id, quoteCount: 2 } });
    const invalid = await call("admin", `/usuarios/${users.target.id}/reasignar`, "POST", { targetUserId: users.source.id });
    expect(invalid.status).toBe(400);
  });
  it("desbloquea y registra auditoría; aplica filtros, búsqueda, último acceso y conteo", async () => {
    expect((await call("admin", `/usuarios/${users.source.id}`, "PATCH", { action: "unblock" })).status).toBe(200);
    expect((await call("source", "/quotes")).status).toBe(200);
    const history = await call("admin", `/usuarios/${users.source.id}/historial`);
    expect(history.body.items[0]).toMatchObject({ action: "unblock", previousValue: true, newValue: false });
    const listed = await call("admin", `/usuarios?search=${encodeURIComponent(users.target.id)}&role=gerente_comercial&status=active`);
    expect(listed.status).toBe(200);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0]).toMatchObject({ id: users.target.id, quoteCount: 2, isBlocked: false });
    expect(listed.body.items[0].lastAccessAt).not.toBeNull();
    const [audit] = await db.select().from(userRoleHistoryTable).where(and(
      eq(userRoleHistoryTable.userId, users.source.id), eq(userRoleHistoryTable.action, "reassign")));
    expect(audit).toBeDefined();
  });
});
