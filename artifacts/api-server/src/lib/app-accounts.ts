import { randomUUID } from "node:crypto";
import { db, appUsersTable, userRoleHistoryTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

// Shared by bootstrap and admin changes, so two requests cannot remove/seed
// administrators concurrently or override a deliberate role change.
export const USER_MANAGEMENT_LOCK = "app-user-access-management";

export async function provisionAccount(id: string, email: string, name: string, initialAdminEmail?: string) {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${USER_MANAGEMENT_LOCK}))`);
    const [existing] = await tx.select().from(appUsersTable).where(eq(appUsersTable.id, id)).for("update").limit(1);
    const [admin] = await tx.select({ id: appUsersTable.id }).from(appUsersTable)
      .where(eq(appUsersTable.role, "admin")).limit(1);
    const bootstrap = !admin && initialAdminEmail && email.toLowerCase() === initialAdminEmail.toLowerCase();
    if (existing) {
      // Existing installations may already have the configured initial user's
      // commercial row. Bootstrap it only if no administrator exists at all.
      const promote = bootstrap && !existing.isBlocked && existing.role !== "admin";
      const [updated] = await tx.update(appUsersTable).set({
        email, name, ...(promote ? { role: "admin" as const } : {}),
      }).where(eq(appUsersTable.id, id)).returning();
      if (promote) await tx.insert(userRoleHistoryTable).values({
        id: randomUUID(), userId: id, changedBy: id, action: "role_change",
        previousValue: existing.role, newValue: "admin",
      });
      return updated!;
    }
    const role = bootstrap ? "admin" : "comercial";
    const [created] = await tx.insert(appUsersTable).values({ id, email, name, role, isBlocked: false })
      .onConflictDoNothing().returning();
    if (!created) throw new Error("Account provisioning conflict");
    return created;
  });
}
