import { describe, expect, it } from "vitest";
import { assertActiveAdministratorRemains } from "./user-management";

describe("Protección del último administrador activo", () => {
  it("rechaza quitar el rol o bloquear si solo queda uno", () => {
    expect(() => assertActiveAdministratorRemains(1)).toThrow("último administrador activo");
    expect(() => assertActiveAdministratorRemains(0)).toThrow("último administrador activo");
  });
  it("permite el cambio si existe otro administrador activo", () => {
    expect(() => assertActiveAdministratorRemains(2)).not.toThrow();
  });
});
