import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ existing: undefined as any, hasAdmin: false, audits: [] as any[] }));
vi.mock("@workspace/db", () => ({
  appUsersTable: { id: "id", role: "role" },
  userRoleHistoryTable: {},
  db: { transaction: async (run: any) => {
    let selections = 0;
    return run({
      execute: async () => undefined,
      select: () => ({ from: () => ({ where: () => {
        const limit = async () => ++selections === 1
          ? state.existing ? [state.existing] : []
          : state.hasAdmin ? [{ id: "another-admin" }] : [];
        return { limit, for: () => ({ limit }) };
      } }) }),
      insert: () => ({ values: (value: any) => {
        if (value.action) state.audits.push(value);
        return { onConflictDoNothing: () => ({ returning: async () => [value] }) };
      } }),
      update: () => ({ set: (value: any) => ({ where: () => ({ returning: async () => [{ ...state.existing, ...value }] }) }) }),
    });
  } },
}));
import { provisionAccount } from "./app-accounts";

describe("Primer administrador: bootstrap único y roles persistidos", () => {
  beforeEach(() => { state.existing = undefined; state.hasAdmin = false; state.audits = []; });
  it("crea el primer admin solo para INITIAL_ADMIN_EMAIL y sin admins existentes", async () => {
    expect((await provisionAccount("new", "admin@example.invalid", "Admin", "admin@example.invalid")).role).toBe("admin");
    state.hasAdmin = true;
    expect((await provisionAccount("new", "admin@example.invalid", "Admin", "admin@example.invalid")).role).toBe("comercial");
  });
  it("registra nuevas cuentas como comerciales activas", async () => {
    expect(await provisionAccount("new", "sales@example.invalid", "Comercial", "admin@example.invalid"))
      .toMatchObject({ role: "comercial", isBlocked: false });
  });
  it("nunca repromueve ni desbloquea una cuenta existente al actualizar identidad", async () => {
    state.existing = { id: "existing", role: "comercial", isBlocked: true };
    expect(await provisionAccount("existing", "admin@example.invalid", "Admin", "admin@example.invalid"))
      .toMatchObject({ role: "comercial", isBlocked: true });
  });
  it("permite crear el primer admin desde una cuenta previa activa, pero no sobrescribe roles si ya existe otro", async () => {
    state.existing = { id: "existing", role: "comercial", isBlocked: false };
    expect((await provisionAccount("existing", "admin@example.invalid", "Admin", "admin@example.invalid")).role).toBe("admin");
    expect(state.audits).toEqual([expect.objectContaining({
      userId: "existing", changedBy: "existing", action: "role_change", previousValue: "comercial", newValue: "admin",
    })]);
    state.hasAdmin = true;
    expect((await provisionAccount("existing", "admin@example.invalid", "Admin", "admin@example.invalid")).role).toBe("comercial");
  });
});
