import { Router, type IRouter, type Request, type Response } from "express";
import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, appUsersTable, quotesTable, userRoleHistoryTable } from "@workspace/db";
import {
  GetUsersQueryParams, GetUsersResponse, UpdateUserAccessParams, UpdateUserAccessBody, UpdateUserAccessResponse,
  ReassignUserQuotesParams, ReassignUserQuotesBody, ReassignUserQuotesResponse,
  GetUserRoleHistoryParams, GetUserRoleHistoryResponse,
} from "@workspace/api-zod";
import { requireRole } from "../middlewares/require-role";
import { updateUserAccess, reassignUserQuotes, UserManagementError } from "../lib/user-management";

const router: IRouter = Router();
router.use("/usuarios", requireRole("admin"));
const guarded = (handler: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "private, no-store");
  try { await handler(req, res); }
  catch (error) {
    if (error instanceof UserManagementError) { res.status(error.status).json({ error: error.message }); return; }
    req.log.error({ err: error }, "User management failed");
    res.status(500).json({ error: "No fue posible gestionar los usuarios. Inténtelo de nuevo." });
  }
};
router.get("/usuarios", guarded(async (req, res) => {
  const parsed = GetUsersQueryParams.safeParse(req.query);
  if (!parsed.success) throw new UserManagementError(400, "Búsqueda, filtros o página inválidos.");
  const { role, status } = parsed.data;
  const page = parsed.data.page ?? 1, pageSize = 25;
  const search = parsed.data.search?.trim().replace(/[\\%_]/g, "\\$&");
  const where = and(role ? eq(appUsersTable.role, role) : undefined,
    status ? eq(appUsersTable.isBlocked, status === "blocked") : undefined,
    search ? or(ilike(appUsersTable.name, `%${search}%`), ilike(appUsersTable.email, `%${search}%`)) : undefined);
  const [items, [total]] = await Promise.all([
    db.select({
      id: appUsersTable.id, name: appUsersTable.name, email: appUsersTable.email, role: appUsersTable.role,
      isBlocked: appUsersTable.isBlocked, createdAt: appUsersTable.createdAt, lastAccessAt: appUsersTable.lastAccessAt,
      quoteCount: sql<number>`(select count(*)::integer from ${quotesTable} q where q.owner_id = "app_users"."id")`,
    }).from(appUsersTable).where(where).orderBy(desc(appUsersTable.createdAt), appUsersTable.id)
      .limit(pageSize).offset((page - 1) * pageSize),
    db.select({ value: count() }).from(appUsersTable).where(where),
  ]);
  res.json(GetUsersResponse.parse({ items, total: total?.value ?? 0, page, pageSize }));
}));
router.patch("/usuarios/:id", guarded(async (req, res) => {
  const params = UpdateUserAccessParams.safeParse(req.params), input = UpdateUserAccessBody.safeParse(req.body);
  if (!params.success || !input.success) throw new UserManagementError(400, "Revise el usuario, la acción y el rol.");
  res.json(UpdateUserAccessResponse.parse(await updateUserAccess(res.locals.appUser.id, params.data.id, input.data)));
}));
router.post("/usuarios/:id/reasignar", guarded(async (req, res) => {
  const params = ReassignUserQuotesParams.safeParse(req.params), input = ReassignUserQuotesBody.safeParse(req.body);
  if (!params.success || !input.success) throw new UserManagementError(400, "Seleccione un usuario de destino válido.");
  res.json(ReassignUserQuotesResponse.parse(await reassignUserQuotes(res.locals.appUser.id, params.data.id, input.data.targetUserId)));
}));
router.get("/usuarios/:id/historial", guarded(async (req, res) => {
  const params = GetUserRoleHistoryParams.safeParse(req.params);
  if (!params.success) throw new UserManagementError(400, "Identificador inválido.");
  const [user] = await db.select({ id: appUsersTable.id }).from(appUsersTable).where(eq(appUsersTable.id, params.data.id)).limit(1);
  if (!user) throw new UserManagementError(404, "Usuario no encontrado.");
  const rows = await db.select({ entry: userRoleHistoryTable, changedByName: appUsersTable.name })
    .from(userRoleHistoryTable).innerJoin(appUsersTable, eq(appUsersTable.id, userRoleHistoryTable.changedBy))
    .where(eq(userRoleHistoryTable.userId, params.data.id)).orderBy(desc(userRoleHistoryTable.changedAt), desc(userRoleHistoryTable.id));
  res.json(GetUserRoleHistoryResponse.parse({ items: rows.map(row => ({ ...row.entry, changedByName: row.changedByName })) }));
}));
export default router;
