import { randomUUID } from "node:crypto";
import { and, count, eq, sql } from "drizzle-orm";
import { db, appUsersTable, quotesTable, userRoleHistoryTable, type AppUserRecord } from "@workspace/db";
import { USER_MANAGEMENT_LOCK } from "./app-accounts";
import { BLOCKED_ACCESS_MESSAGE } from "../middlewares/require-role";

export class UserManagementError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
type AccessAction = { action: "role_change" | "block" | "unblock"; role?: AppUserRecord["role"] };
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function assertActiveAdministratorRemains(activeCount: number) {
  if (activeCount <= 1)
    throw new UserManagementError(409, "No puede quitar el rol ni bloquear al último administrador activo.");
}

async function lockAdministrator(tx: Transaction, actorId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${USER_MANAGEMENT_LOCK}))`);
  const [actor] = await tx.select().from(appUsersTable).where(eq(appUsersTable.id, actorId)).for("update").limit(1);
  if (actor?.isBlocked) throw new UserManagementError(403, BLOCKED_ACCESS_MESSAGE);
  if (actor?.role !== "admin") throw new UserManagementError(403, "Solo un administrador puede gestionar usuarios.");
}

export async function updateUserAccess(actorId: string, userId: string, input: AccessAction) {
  return db.transaction(async tx => {
    await lockAdministrator(tx, actorId);
    const [target] = await tx.select().from(appUsersTable).where(eq(appUsersTable.id, userId)).for("update").limit(1);
    if (!target) throw new UserManagementError(404, "Usuario no encontrado.");
    if (actorId === userId && (input.action === "role_change" || input.action === "block"))
      throw new UserManagementError(403, "No puede cambiar su propio rol ni bloquearse a sí mismo.");
    if (input.action === "role_change" && !input.role)
      throw new UserManagementError(400, "Seleccione un rol válido.");
    const isRole = input.action === "role_change";
    const previousValue = isRole ? target.role : target.isBlocked;
    const newValue = isRole ? input.role! : input.action === "block";
    if (previousValue === newValue) return { success: true };
    const removesActiveAdmin = target.role === "admin" && !target.isBlocked &&
      (input.action === "block" || (isRole && input.role !== "admin"));
    if (removesActiveAdmin) {
      const [active] = await tx.select({ value: count() }).from(appUsersTable)
        .where(and(eq(appUsersTable.role, "admin"), eq(appUsersTable.isBlocked, false)));
      assertActiveAdministratorRemains(active?.value ?? 0);
    }
    await tx.update(appUsersTable).set(isRole ? { role: input.role! } : { isBlocked: input.action === "block" })
      .where(eq(appUsersTable.id, userId));
    await tx.insert(userRoleHistoryTable).values({
      id: randomUUID(), userId, changedBy: actorId, action: input.action, previousValue, newValue,
    });
    return { success: true };
  });
}

export async function reassignUserQuotes(actorId: string, userId: string, targetUserId: string) {
  return db.transaction(async tx => {
    await lockAdministrator(tx, actorId);
    if (userId === targetUserId) throw new UserManagementError(400, "Seleccione un usuario de destino diferente.");
    const [source] = await tx.select().from(appUsersTable).where(eq(appUsersTable.id, userId)).for("update").limit(1);
    const [target] = await tx.select().from(appUsersTable).where(eq(appUsersTable.id, targetUserId)).for("update").limit(1);
    if (!source || !target) throw new UserManagementError(404, "Usuario no encontrado.");
    if (target.isBlocked) throw new UserManagementError(400, "El usuario de destino debe estar activo.");
    const transferred = await tx.update(quotesTable).set({ ownerId: target.id })
      .where(eq(quotesTable.ownerId, source.id)).returning({ id: quotesTable.id });
    await tx.insert(userRoleHistoryTable).values({
      id: randomUUID(), userId, changedBy: actorId, action: "reassign",
      previousValue: { ownerId: source.id, quoteCount: transferred.length },
      newValue: { ownerId: target.id, quoteCount: transferred.length },
    });
    return { success: true, transferredCount: transferred.length };
  });
}
