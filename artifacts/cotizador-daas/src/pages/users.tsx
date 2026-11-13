import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetUsers, getGetUsersQueryKey, useUpdateUserAccess, useReassignUserQuotes,
  useGetUserRoleHistory, getGetUserRoleHistoryQueryKey, getGetSavedQuotesQueryKey,
  type UserAccount, type UserRole, type GetUsersParams, type GetUsersStatus,
} from "@workspace/api-client-react";
import { useAppSession } from "@/hooks/use-app-session";
import { ROLE_LABELS, apiErrorMessage } from "@/lib/api-errors";
import "@/history-auth.css";
import "@/users.css";

const fmt = (d: string | null) => d ? new Date(d).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "Nunca";
const ROLES: UserRole[] = ["comercial", "gerente_comercial", "admin"];
const ACTION_LABELS: Record<string, string> = { role_change: "Cambio de rol", block: "Bloqueo", unblock: "Desbloqueo", reassign: "Reasignación de cotizaciones" };

function useDebounced(value: string, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value.trim()), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function showValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Bloqueado" : "Activo";
  if (typeof v === "string") return ROLE_LABELS[v] ?? v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("role" in o && Object.keys(o).length === 1) return showValue(o.role);
    if ("isBlocked" in o && Object.keys(o).length === 1) return showValue(o.isBlocked);
    return Object.entries(o).map(([k, val]) => `${k}: ${typeof val === "object" ? JSON.stringify(val) : showValue(val)}`).join(" · ");
  }
  return String(v);
}

type Pending =
  | { kind: "role"; user: UserAccount; role: UserRole }
  | { kind: "block" | "unblock"; user: UserAccount }
  | { kind: "reassign"; user: UserAccount; target: UserAccount };

export default function UsersPage() {
  const { user: me } = useAppSession();
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const search = useDebounced(input);
  const [role, setRole] = useState<UserRole | "">("");
  const [status, setStatus] = useState<GetUsersStatus | "">("");
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, role, status]);
  const params: GetUsersParams = { ...(search ? { search } : {}), ...(role ? { role } : {}), ...(status ? { status } : {}), page };
  const list = useGetUsers(params, { query: { enabled: me?.role === "admin", queryKey: [...getGetUsersQueryKey(params), me?.id, me?.role] } });

  const [roleDraft, setRoleDraft] = useState<Record<string, UserRole>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [reassignFor, setReassignFor] = useState<UserAccount | null>(null);
  const [historyFor, setHistoryFor] = useState<UserAccount | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const access = useUpdateUserAccess();
  const reassign = useReassignUserQuotes();

  const invalidate = (id: string) => {
    void qc.invalidateQueries({ queryKey: getGetUsersQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetUserRoleHistoryQueryKey(id) });
    void qc.invalidateQueries({ queryKey: getGetSavedQuotesQueryKey() });
    void qc.invalidateQueries({ predicate: q => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).includes("/quotes") });
  };

  const confirm = () => {
    if (!pending) return;
    setError("");
    const id = pending.user.id;
    if (pending.kind === "reassign") {
      reassign.mutate({ id, data: { targetUserId: pending.target.id } }, {
        onSuccess: r => { invalidate(id); invalidate(pending.target.id); setNotice(`Se transfirieron ${r.transferredCount} cotizaciones a ${pending.target.name}.`); setPending(null); setReassignFor(null); },
        onError: e => setError(apiErrorMessage(e, "No se pudieron reasignar las cotizaciones.")),
      });
      return;
    }
    const data = pending.kind === "role" ? { action: "role_change" as const, role: pending.role } : { action: pending.kind };
    access.mutate({ id, data }, {
      onSuccess: () => {
        invalidate(id);
        setNotice(pending.kind === "role" ? `Rol de ${pending.user.name} actualizado a ${ROLE_LABELS[pending.role]}.` : `${pending.user.name} ${pending.kind === "block" ? "ha sido bloqueado" : "ha sido desbloqueado"}.`);
        setRoleDraft(d => { const n = { ...d }; delete n[id]; return n; });
        setPending(null);
      },
      onError: e => setError(apiErrorMessage(e, "No se pudo actualizar el acceso.")),
    });
  };

  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const busy = access.isPending || reassign.isPending;

  return (
    <main className="nt-wrap">
      <h1>Usuarios</h1>
      <p className="nt-sub">Roles, acceso y titularidad de cotizaciones. Los cambios quedan registrados en el historial de cada usuario.</p>
      <div className="us-filters">
        <input className="us-input" value={input} onChange={e => setInput(e.target.value)} maxLength={200} placeholder="Buscar por nombre o correo" aria-label="Buscar usuarios" data-testid="input-user-search" />
        <select className="us-input" value={role} onChange={e => setRole(e.target.value as UserRole | "")} aria-label="Filtrar por rol" data-testid="select-role-filter">
          <option value="">Todos los roles</option>
          {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
        <select className="us-input" value={status} onChange={e => setStatus(e.target.value as GetUsersStatus | "")} aria-label="Filtrar por estado" data-testid="select-status-filter">
          <option value="">Todos los estados</option>
          <option value="active">Activo</option>
          <option value="blocked">Bloqueado</option>
        </select>
      </div>
      {notice && <div className="us-notice" role="status" data-testid="text-user-notice">{notice}<button className="nt-linkbtn" onClick={() => setNotice("")}>Cerrar</button></div>}
      {error && !pending && <div className="nt-state error" role="alert" data-testid="text-user-error"><p>{error}</p></div>}
      {list.isLoading ? (
        <div className="nt-table-wrap" aria-busy="true" data-testid="state-users-loading">{[0, 1, 2, 3, 4].map(i => <div key={i} className="nt-skel" />)}</div>
      ) : list.isError ? (
        <div className="nt-state error" role="alert" data-testid="state-users-error"><h2>No se pudo cargar la lista de usuarios</h2><p>{apiErrorMessage(list.error, "Inténtelo de nuevo.")}</p><button className="nt-btn" onClick={() => void list.refetch()} data-testid="button-users-retry">Reintentar</button></div>
      ) : !data || data.items.length === 0 ? (
        <div className="nt-state" data-testid="state-users-empty"><h2>Sin usuarios</h2><p>Ningún usuario coincide con los filtros aplicados.</p><button className="nt-btn ghost" onClick={() => { setInput(""); setRole(""); setStatus(""); }} data-testid="button-clear-filters">Limpiar filtros</button></div>
      ) : (
        <>
          <div className="nt-table-wrap">
            <table className="nt-table">
              <thead><tr><th>NOMBRE</th><th>CORREO</th><th>ROL</th><th>ESTADO</th><th>ALTA</th><th>ÚLTIMO ACCESO</th><th>COTIZACIONES</th><th>ACCIONES</th></tr></thead>
              <tbody>{data.items.map(u => {
                const self = u.id === me?.id;
                const draft = roleDraft[u.id] ?? u.role;
                return (
                  <tr key={u.id} data-testid={`row-user-${u.id}`}>
                    <td><strong>{u.name}</strong>{self && <> <span className="nt-badge">Usted</span></>}</td>
                    <td>{u.email}</td>
                    <td>
                      <div className="us-role">
                        <select className="us-input sm" value={draft} disabled={self || busy} title={self ? "No puede cambiar su propio rol." : undefined} onChange={e => setRoleDraft(d => ({ ...d, [u.id]: e.target.value as UserRole }))} aria-label={`Rol de ${u.name}`} data-testid={`select-role-${u.id}`}>
                          {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                        </select>
                        {!self && draft !== u.role && <button className="nt-linkbtn" onClick={() => { setError(""); setPending({ kind: "role", user: u, role: draft }); }} data-testid={`button-apply-role-${u.id}`}>Aplicar</button>}
                      </div>
                    </td>
                    <td><span className={`nt-badge ${u.isBlocked ? "deleted" : "us-active"}`} data-testid={`status-user-${u.id}`}>{u.isBlocked ? "Bloqueado" : "Activo"}</span></td>
                    <td>{fmt(u.createdAt)}</td>
                    <td>{fmt(u.lastAccessAt)}</td>
                    <td className="num">{u.quoteCount}</td>
                    <td>
                      {self ? <span className="us-hint" data-testid={`text-self-hint-${u.id}`}>No puede cambiar su propio rol ni bloquearse.</span>
                        : u.isBlocked
                          ? <button className="nt-linkbtn" disabled={busy} onClick={() => { setError(""); setPending({ kind: "unblock", user: u }); }} data-testid={`button-unblock-${u.id}`}>Desbloquear</button>
                          : <button className="nt-linkbtn danger" disabled={busy} onClick={() => { setError(""); setPending({ kind: "block", user: u }); }} data-testid={`button-block-${u.id}`}>Bloquear</button>}
                      <button className="nt-linkbtn" disabled={busy} onClick={() => { setError(""); setReassignFor(u); }} data-testid={`button-reassign-${u.id}`}>Reasignar</button>
                      <button className="nt-linkbtn" onClick={() => setHistoryFor(u)} data-testid={`button-history-${u.id}`}>Historial</button>
                    </td>
                  </tr>);
              })}</tbody>
            </table>
          </div>
          <div className="nt-pager">
            <span data-testid="text-users-total">{data.total} usuarios · Página {data.page} de {pages}</span>
            <div className="nt-actions">
              <button className="nt-btn ghost" disabled={page <= 1} onClick={() => setPage(p => p - 1)} data-testid="button-users-prev">Anterior</button>
              <button className="nt-btn ghost" disabled={page >= pages} onClick={() => setPage(p => p + 1)} data-testid="button-users-next">Siguiente</button>
            </div>
          </div>
        </>
      )}
      {reassignFor && !pending && <ReassignDialog source={reassignFor} meId={me?.id} onCancel={() => setReassignFor(null)} onPick={t => { setError(""); setPending({ kind: "reassign", user: reassignFor, target: t }); }} />}
      {pending && <ConfirmDialog pending={pending} busy={busy} error={error} onCancel={() => { setPending(null); setError(""); }} onConfirm={confirm} />}
      {historyFor && <HistoryDialog user={historyFor} onClose={() => setHistoryFor(null)} />}
    </main>
  );
}

function ConfirmDialog({ pending, busy, error, onCancel, onConfirm }: { pending: Pending; busy: boolean; error: string; onCancel: () => void; onConfirm: () => void }) {
  const u = pending.user;
  const target = pending.kind === "reassign" ? pending.target : null;
  const title = pending.kind === "role" ? `Cambiar rol de ${u.name}` : pending.kind === "block" ? `Bloquear a ${u.name}` : pending.kind === "unblock" ? `Desbloquear a ${u.name}` : `Reasignar cotizaciones de ${u.name}`;
  const body = pending.kind === "role"
    ? <p>El rol pasará de <strong>{ROLE_LABELS[u.role]}</strong> a <strong>{ROLE_LABELS[pending.role]}</strong>. Los permisos cambian en su próxima solicitud.</p>
    : pending.kind === "block"
      ? <p>{u.name} perderá el acceso a la aplicación de inmediato. Sus cotizaciones se conservan.</p>
      : pending.kind === "unblock"
        ? <p>{u.name} podrá volver a iniciar sesión con su rol actual ({ROLE_LABELS[u.role]}).</p>
        : <><p>Se transferirá la titularidad de <strong>todas</strong> las cotizaciones de {u.name} ({u.quoteCount}), incluidas las eliminadas, a <strong>{target?.name}</strong> ({target?.email}).</p><p className="us-hint">La transferencia cambia el propietario; los autores registrados en cada versión se mantienen sin cambios.</p></>;
  return (
    <div className="nt-modal-back" role="dialog" aria-modal="true" aria-labelledby="us-confirm-title">
      <div className="nt-modal">
        <h2 id="us-confirm-title">{title}</h2>
        {body}
        {error && <div className="nt-state error" role="alert" data-testid="text-confirm-error"><p>{error}</p></div>}
        <div className="nt-actions">
          <button className="nt-btn ghost" onClick={onCancel} disabled={busy} data-testid="button-confirm-cancel">Cancelar</button>
          <button className={`nt-btn ${pending.kind === "block" ? "nt-danger" : ""}`} onClick={onConfirm} disabled={busy} data-testid="button-confirm-action">{busy ? "Aplicando…" : "Confirmar"}</button>
        </div>
      </div>
    </div>
  );
}

function ReassignDialog({ source, meId, onCancel, onPick }: { source: UserAccount; meId?: string; onCancel: () => void; onPick: (u: UserAccount) => void }) {
  const [input, setInput] = useState("");
  const search = useDebounced(input);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search]);
  const params: GetUsersParams = { ...(search ? { search } : {}), status: "active", page };
  const q = useGetUsers(params, { query: { queryKey: [...getGetUsersQueryKey(params), meId, "reassign"] } });
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  const items = (q.data?.items ?? []).filter(u => u.id !== source.id && !u.isBlocked);
  return (
    <div className="nt-modal-back" role="dialog" aria-modal="true" aria-labelledby="us-reassign-title">
      <div className="nt-modal us-wide">
        <h2 id="us-reassign-title">Reasignar cotizaciones de {source.name}</h2>
        <p className="us-hint">Elija un usuario activo como nuevo propietario. Se incluyen las cotizaciones eliminadas; los autores de cada versión no cambian.</p>
        <input className="us-input" value={input} onChange={e => setInput(e.target.value)} placeholder="Buscar destinatario" aria-label="Buscar destinatario" data-testid="input-reassign-search" />
        <div className="us-picker">
          {q.isLoading ? [0, 1, 2].map(i => <div key={i} className="nt-skel" />)
            : q.isError ? <div className="nt-state error" role="alert"><p>{apiErrorMessage(q.error, "No se pudo cargar la lista.")}</p><button className="nt-btn" onClick={() => void q.refetch()}>Reintentar</button></div>
            : items.length === 0 ? <p className="us-hint" data-testid="state-reassign-empty">No hay usuarios activos que coincidan.</p>
            : items.map(u => (
              <button key={u.id} className="us-pick" onClick={() => onPick(u)} data-testid={`button-pick-${u.id}`}>
                <span><strong>{u.name}</strong><small>{u.email}</small></span><em>{ROLE_LABELS[u.role]}</em>
              </button>))}
        </div>
        <div className="nt-pager">
          <span>Página {q.data?.page ?? page} de {pages}</span>
          <div className="nt-actions">
            <button className="nt-btn ghost" disabled={page <= 1} onClick={() => setPage(p => p - 1)} data-testid="button-reassign-prev">Anterior</button>
            <button className="nt-btn ghost" disabled={page >= pages} onClick={() => setPage(p => p + 1)} data-testid="button-reassign-next">Siguiente</button>
          </div>
        </div>
        <div className="nt-actions" style={{ marginTop: 12 }}><button className="nt-btn ghost" onClick={onCancel} data-testid="button-reassign-cancel">Cancelar</button></div>
      </div>
    </div>
  );
}

function HistoryDialog({ user, onClose }: { user: UserAccount; onClose: () => void }) {
  const h = useGetUserRoleHistory(user.id, { query: { queryKey: getGetUserRoleHistoryQueryKey(user.id) } });
  return (
    <div className="nt-modal-back" role="dialog" aria-modal="true" aria-labelledby="us-hist-title">
      <div className="nt-modal us-wide">
        <h2 id="us-hist-title">Historial de {user.name}</h2>
        {h.isLoading ? <div aria-busy="true">{[0, 1, 2].map(i => <div key={i} className="nt-skel" />)}</div>
          : h.isError ? <div className="nt-state error" role="alert"><p>{apiErrorMessage(h.error, "No se pudo cargar el historial.")}</p><button className="nt-btn" onClick={() => void h.refetch()}>Reintentar</button></div>
          : !h.data || h.data.items.length === 0 ? <p className="us-hint" data-testid="state-history-empty">Sin cambios registrados.</p>
          : <div className="nt-table-wrap"><table className="nt-table">
              <thead><tr><th>FECHA</th><th>REALIZADO POR</th><th>ACCIÓN</th><th>ANTES</th><th>DESPUÉS</th></tr></thead>
              <tbody>{h.data.items.map(e => (
                <tr key={e.id} data-testid={`row-history-${e.id}`}>
                  <td>{fmt(e.changedAt)}</td><td>{e.changedByName}</td><td>{ACTION_LABELS[e.action] ?? e.action}</td>
                  <td className="us-wrap">{showValue(e.previousValue)}</td><td className="us-wrap">{showValue(e.newValue)}</td>
                </tr>))}</tbody>
            </table></div>}
        <div className="nt-actions" style={{ marginTop: 14 }}><button className="nt-btn" onClick={onClose} data-testid="button-history-close">Cerrar</button></div>
      </div>
    </div>
  );
}
