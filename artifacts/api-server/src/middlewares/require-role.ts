import type { RequestHandler } from "express";
import type { AppUserRecord } from "@workspace/db";

export const BLOCKED_ACCESS_MESSAGE = "Su acceso ha sido desactivado. Contacte con un administrador.";
export const APP_ROLES = ["comercial", "gerente_comercial", "admin"] as const;
export const canViewProfitability = (user: Pick<AppUserRecord, "role">) =>
  user.role === "admin" || user.role === "gerente_comercial";

/** Authentication supplies the database user, never a browser or Clerk role claim. */
export function requireRole(...roles: AppUserRecord["role"][]): RequestHandler {
  return (_req, res, next) => {
    const user = res.locals.appUser as AppUserRecord | undefined;
    if (user?.isBlocked) {
      res.status(403).json({ error: BLOCKED_ACCESS_MESSAGE }); return;
    }
    if (!user || !roles.includes(user.role)) {
      res.status(403).json({ error: "No tiene permiso para acceder a este recurso." }); return;
    }
    next();
  };
}
