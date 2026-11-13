type ApiLike = { status: number; data: unknown };
const asApi = (e: unknown): ApiLike | null =>
  e instanceof Error && typeof (e as unknown as ApiLike).status === "number" ? (e as unknown as ApiLike) : null;

export const errorStatus = (e: unknown) => asApi(e)?.status;

export const BLOCKED_MESSAGE = "Su acceso ha sido desactivado. Contacte con un administrador.";

/** Returns the backend message verbatim when present. */
export function apiErrorMessage(e: unknown, fallback: string): string {
  const api = asApi(e);
  if (api) {
    const d = api.data as { message?: unknown; error?: unknown } | null;
    if (d && typeof d.message === "string" && d.message) return d.message;
    if (d && typeof d.error === "string" && d.error) return d.error;
  }
  return e instanceof Error && e.message ? e.message : fallback;
}

export function isBlockedError(e: unknown): boolean {
  if (errorStatus(e) !== 403) return false;
  const m = apiErrorMessage(e, "").toLowerCase();
  return m.includes("desactivad") || m.includes("bloquead") || m.includes("blocked");
}

export const ROLE_LABELS: Record<string, string> = { comercial: "Comercial", gerente_comercial: "Gerente comercial", admin: "Administrador" };
