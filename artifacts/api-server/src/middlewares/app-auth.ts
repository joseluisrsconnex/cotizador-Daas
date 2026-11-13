import { clerkClient, getAuth } from "@clerk/express";
import type { RequestHandler } from "express";
import { db, appUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getClerkProxyHost } from "./clerkProxyMiddleware";
import { provisionAccount } from "../lib/app-accounts";
import { requireRole, BLOCKED_ACCESS_MESSAGE } from "./require-role";
export { requireRole } from "./require-role";

export const sameOrigin: RequestHandler = (req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== getClerkProxyHost(req)) {
        res.status(403).json({ error: "Solicitud de origen no permitido." });
        return;
      }
    } catch {
      res.status(403).json({ error: "Origen inválido." });
      return;
    }
  }
  next();
};

export const requireUser: RequestHandler = async (req, res, next) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Inicie sesión para continuar." });
    return;
  }
  try {
    const [existing] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, userId)).limit(1);
    let user = existing;
    if (user?.isBlocked) {
      res.status(403).json({ error: BLOCKED_ACCESS_MESSAGE }); return;
    }
    if (!existing || req.path === "/auth/me") {
      const identity = await clerkClient.users.getUser(userId);
      const primary = identity.emailAddresses.find(e => e.id === identity.primaryEmailAddressId);
      if (!primary || primary.verification?.status !== "verified") {
        res.status(403).json({ error: "Verifique su correo para acceder a la aplicación." });
        return;
      }
      const name = [identity.firstName, identity.lastName].filter(Boolean).join(" ") || primary.emailAddress.split("@")[0];
      user = await provisionAccount(userId, primary.emailAddress, name, process.env.INITIAL_ADMIN_EMAIL?.trim());
    }
    if (!user) throw new Error("No local account");
    // Reload while recording access: a concurrent block is enforced even if the
    // original read happened before it committed. Every protected request checks DB.
    [user] = await db.update(appUsersTable).set({ lastAccessAt: new Date() })
      .where(eq(appUsersTable.id, userId)).returning();
    if (!user || user.isBlocked) {
      res.status(403).json({ error: BLOCKED_ACCESS_MESSAGE }); return;
    }
    res.locals.appUser = user;
    next();
  } catch (error) {
    req.log.warn({ userId, errorName: error instanceof Error ? error.name : "Unknown" }, "Account provisioning failed");
    res.status(503).json({ error: "No fue posible verificar su cuenta. Inténtelo de nuevo." });
  }
};

export const requireAdmin = requireRole("admin");
