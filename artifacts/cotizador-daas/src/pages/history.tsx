import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGetSavedQuotes, getGetSavedQuotesQueryKey, getGetSavedQuoteQueryKey, getGetQuoteVersionsQueryKey, useDeleteSavedQuote, useRestoreSavedQuote } from "@workspace/api-client-react";
import { useAppSession } from "@/hooks/use-app-session";
import { formatUsd } from "@/lib/format";
import Decimal from "decimal.js";
import DeleteQuoteDialog from "@/components/delete-quote-dialog";
import { marginState } from "@/components/version-profitability";
import { apiErrorMessage } from "@/lib/api-errors";
import "@/history-auth.css";

export default function HistoryPage() {
  const { user } = useAppSession();
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showDeleted, setShowDeleted] = useState(false);
  const [belowTarget, setBelowTarget] = useState(false);
  const [target, setTarget] = useState<{ id: string; customer: string } | null>(null);
  const [actionError, setActionError] = useState("");
  const queryClient = useQueryClient();
  const del = useDeleteSavedQuote();
  const restore = useRestoreSavedQuote();
  const isAdmin = user?.role === "admin";
  const isManager = user?.role === "gerente_comercial";
  const seesAll = isAdmin || isManager;
  const refresh = (id: string) => {
    void queryClient.invalidateQueries({ queryKey: getGetSavedQuotesQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetSavedQuoteQueryKey(id) });
    void queryClient.invalidateQueries({ queryKey: getGetQuoteVersionsQueryKey(id) });
  };
  const confirmDelete = () => {
    if (!target) return;
    setActionError("");
    del.mutate({ id: target.id }, {
      onSuccess: () => { refresh(target.id); setTarget(null); },
      onError: e => setActionError(apiErrorMessage(e, "No se pudo eliminar la cotización.")),
    });
  };
  const doRestore = (id: string) => {
    setActionError("");
    restore.mutate({ id }, { onSuccess: () => refresh(id), onError: e => setActionError(apiErrorMessage(e, "No se pudo restaurar la cotización.")) });
  };
  useEffect(() => {
    const t = setTimeout(() => { setSearch(input.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [input]);
  const params = { ...(search ? { search } : {}), ...(seesAll && showDeleted ? { showDeleted: true } : {}), ...(seesAll && belowTarget ? { belowTarget: true } : {}), page };
  const q = useGetSavedQuotes(params, {
    query: { enabled: Boolean(user), queryKey: [...getGetSavedQuotesQueryKey(params), user?.id, user?.role] },
  });
  const data = q.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <main className="nt-wrap">
      <h1>Cotizaciones guardadas</h1>
      <p className="nt-sub">{seesAll ? "Todas las cotizaciones." : "Sus cotizaciones."}</p>
      <form className="nt-search" role="search" onSubmit={e => { e.preventDefault(); setSearch(input.trim()); setPage(1); }}>
        <input value={input} onChange={e => setInput(e.target.value)} maxLength={120} placeholder="Buscar por nombre o Cotización ID" aria-label="Buscar por nombre o Cotización ID" data-testid="input-search" />
        <button className="nt-btn" type="submit" data-testid="button-search">Buscar</button>
      </form>
      {seesAll && <label className="nt-check"><input type="checkbox" checked={showDeleted} onChange={e => { setShowDeleted(e.target.checked); setPage(1); }} data-testid="checkbox-show-deleted" /> Mostrar eliminadas</label>}
      {seesAll && <label className="nt-check"><input type="checkbox" checked={belowTarget} onChange={e => { setBelowTarget(e.target.checked); setPage(1); }} data-testid="checkbox-below-target" /> Margen bajo objetivo</label>}
      {actionError && !target && <div className="nt-state error" role="alert" data-testid="text-action-error"><p>{actionError}</p></div>}
      {q.isLoading || !user ? (
        <div className="nt-table-wrap" aria-busy="true" data-testid="state-loading">{[0, 1, 2, 3, 4].map(i => <div key={i} className="nt-skel" />)}</div>
      ) : q.isError ? (
        <div className="nt-state error" role="alert" data-testid="state-error"><h2>No se pudo cargar el historial</h2><p>Revise su conexión e inténtelo de nuevo.</p><button className="nt-btn" onClick={() => void q.refetch()} data-testid="button-retry">Reintentar</button></div>
      ) : !data || data.items.length === 0 ? (
        <div className="nt-state" data-testid="state-empty"><h2>{search ? "Sin resultados" : "Aún no hay cotizaciones"}</h2><p>{search ? `Ningún cliente coincide con "${search}".` : "Las cotizaciones que guarde aparecerán aquí."}</p>{search ? <button className="nt-btn ghost" onClick={() => { setInput(""); setSearch(""); setPage(1); }} data-testid="button-clear">Limpiar búsqueda</button> : <Link href="/cotizador" className="nt-btn" data-testid="link-new-quote">Crear cotización</Link>}</div>
      ) : (
        <>
          <div className="nt-table-wrap">
            <table className="nt-table">
              <thead><tr><th>CLIENTE</th><th>Cotización ID</th><th>ÚLTIMA MODIFICACIÓN</th><th>VERSIÓN</th>{seesAll && <th>CREADA POR</th>}<th>PLAZO</th><th>SERVICIOS</th><th>TOTAL MENSUAL ANTES DE IVA</th><th>Forecast</th>{seesAll && <th>Estado de margen</th>}<th>ACCIONES</th></tr></thead>
              <tbody>
                {data.items.map(item => (
                  <tr key={item.id} data-testid={`row-quote-${item.id}`}>
                    <td>{item.customer}{item.deletedAt && <> <span className="nt-badge deleted" data-testid={`status-deleted-${item.id}`}>Eliminada</span></>}</td>
                    <td>{item.quoteCode || "—"}</td>
                    <td>{new Date(item.updatedAt).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}</td>
                    <td>v{item.versionNumber}</td>
                    {seesAll && <td data-testid={`text-creator-${item.id}`}>{item.createdByName}{item.createdByBlocked && <> <span className="nt-badge deleted" data-testid={`status-creator-blocked-${item.id}`}>Usuario bloqueado</span></>}</td>}
                    <td>{item.termMonths} meses</td>
                    <td>{item.packageType ?? "Servicios individuales"}</td>
                    <td className="num">{formatUsd(new Decimal(item.totalMonthlyBeforeTax))}</td>
                    <td className="num" data-testid={`text-forecast-${item.id}`}>{item.forecast === undefined ? "—" : formatUsd(new Decimal(item.forecast))}</td>
                    {seesAll && <td data-testid={`margin-state-${item.id}`}>{marginState(item.scenarios)}</td>}
                    <td><Link className="nt-link" href={`/cotizaciones/${item.id}`} data-testid={`link-detail-${item.id}`}>Ver detalle</Link>
                      {item.deletedAt ? (isAdmin && <button className="nt-linkbtn" disabled={restore.isPending} onClick={() => doRestore(item.id)} data-testid={`button-restore-${item.id}`}>Restaurar</button>) : <>
                        <Link className="nt-link" href={`/cotizador?edit=${item.id}`} data-testid={`link-edit-${item.id}`}>Editar</Link>
                        <Link className="nt-link" href={`/cotizador?duplicate=${item.id}`} data-testid={`link-duplicate-${item.id}`}>Duplicar</Link>
                        {(isAdmin || item.ownerId === user?.id) && <button className="nt-linkbtn danger" onClick={() => { setActionError(""); setTarget({ id: item.id, customer: item.customer }); }} data-testid={`button-delete-${item.id}`}>Eliminar</button>}</>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="nt-pager">
            <span data-testid="text-total">{data.total} cotizaciones · Página {data.page} de {pages}</span>
            <div className="nt-actions">
              <button className="nt-btn ghost" disabled={page <= 1} onClick={() => setPage(p => p - 1)} data-testid="button-prev">Anterior</button>
              <button className="nt-btn ghost" disabled={page >= pages} onClick={() => setPage(p => p + 1)} data-testid="button-next">Siguiente</button>
            </div>
          </div>
        </>
      )}
      {target && <DeleteQuoteDialog customer={target.customer} pending={del.isPending} error={actionError} onCancel={() => setTarget(null)} onConfirm={confirmDelete} />}
    </main>
  );
}
