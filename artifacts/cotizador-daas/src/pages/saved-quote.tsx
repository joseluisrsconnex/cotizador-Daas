import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSavedQuote, getGetSavedQuoteQueryKey, useGetQuoteVersions, getGetQuoteVersionsQueryKey,
  useGetQuoteVersion, getGetQuoteVersionQueryKey, getGetSavedQuotesQueryKey, useDeleteSavedQuote, useRestoreSavedQuote,
} from "@workspace/api-client-react";
import { useAppSession } from "@/hooks/use-app-session";
import { restoreSavedQuote } from "@/lib/saved-quote";
import { formatUsd } from "@/lib/format";
import Decimal from "decimal.js";
import QuoteSummaryTable from "@/components/quote-summary-table";
import DeleteQuoteDialog from "@/components/delete-quote-dialog";
import VersionProfitability from "@/components/version-profitability";
import { apiErrorMessage } from "@/lib/api-errors";
import "@/history-auth.css";

const fmt = (d: string) => new Date(d).toLocaleString("es-CO", { dateStyle: "long", timeStyle: "short" });

export default function SavedQuotePage({ id, versionId }: { id: string; versionId?: string }) {
  const { user } = useAppSession();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "admin";
  const seesProfit = isAdmin || user?.role === "gerente_comercial";
  const [confirming, setConfirming] = useState(false);
  const [actionError, setActionError] = useState("");
  const del = useDeleteSavedQuote();
  const restore = useRestoreSavedQuote();
  const current = useGetSavedQuote(id, { query: { enabled: Boolean(user && id && !versionId), queryKey: [...getGetSavedQuoteQueryKey(id), user?.id, user?.role] } });
  const historic = useGetQuoteVersion(id, versionId ?? "", { query: { enabled: Boolean(user && id && versionId), queryKey: [...getGetQuoteVersionQueryKey(id, versionId ?? ""), user?.id, user?.role] } });
  const versions = useGetQuoteVersions(id, { query: { enabled: Boolean(user && id && !versionId), queryKey: [...getGetQuoteVersionsQueryKey(id), user?.id, user?.role] } });
  const q = versionId ? historic : current;
  const record = q.data;
  const restored = record ? restoreSavedQuote(record) : undefined;
  const deleted = Boolean(record?.deletedAt);
  const isCurrent = !versionId;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getGetSavedQuotesQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetSavedQuoteQueryKey(id) });
    void queryClient.invalidateQueries({ queryKey: getGetQuoteVersionsQueryKey(id) });
  };
  const confirmDelete = () => {
    setActionError("");
    del.mutate({ id }, {
      onSuccess: () => { refresh(); setConfirming(false); setLocation("/cotizaciones"); },
      onError: e => setActionError(apiErrorMessage(e, "No se pudo eliminar la cotización.")),
    });
  };
  const doRestore = () => {
    setActionError("");
    restore.mutate({ id }, { onSuccess: refresh, onError: e => setActionError(apiErrorMessage(e, "No se pudo restaurar la cotización.")) });
  };
  return (
    <main className="nt-wrap">
      <Link href={versionId ? `/cotizaciones/${id}` : "/cotizaciones"} className="nt-link" data-testid="link-back">{versionId ? "Volver a la versión actual" : "Volver al historial"}</Link>
      {q.isLoading || !user ? (
        <div className="nt-table-wrap" aria-busy="true" style={{ marginTop: 16 }} data-testid="state-loading">{[0, 1, 2, 3].map(i => <div key={i} className="nt-skel" />)}</div>
      ) : q.isError || !record || !restored ? (
        <div className="nt-state error" role="alert" style={{ marginTop: 16 }} data-testid="state-error"><h2>No se encontró la cotización</h2><p>No existe o no tiene permiso para verla.</p><button className="nt-btn" onClick={() => void q.refetch()} data-testid="button-retry">Reintentar</button></div>
      ) : (
        <>
          <h1 style={{ marginTop: 12 }}>{record.customer}</h1>
          <div className="nt-meta">
            <span className="nt-badge">Versión {record.versionNumber}{isCurrent ? " · actual" : " · solo lectura"}</span>
            <span className="nt-badge">Guardada el {fmt(record.createdAt)} por {record.createdByName}</span>
            {seesProfit && record.createdByBlocked && <span className="nt-badge deleted" data-testid="status-creator-blocked">Usuario bloqueado</span>}
            {deleted && <span className="nt-badge deleted" data-testid="status-deleted">Eliminada</span>}
            {isCurrent && !deleted && <>
              <Link href={`/cotizador?edit=${record.id}`} className="nt-btn" data-testid="link-edit">Editar</Link>
              <Link href={`/cotizador?duplicate=${record.id}`} className="nt-btn ghost" data-testid="link-duplicate">Duplicar cotización</Link>
              {(isAdmin || record.ownerId === user?.id) && <button className="nt-btn nt-danger" onClick={() => { setActionError(""); setConfirming(true); }} data-testid="button-delete">Eliminar</button>}
            </>}
            {isCurrent && deleted && isAdmin && <button className="nt-btn" disabled={restore.isPending} onClick={doRestore} data-testid="button-restore">{restore.isPending ? "Restaurando…" : "Restaurar"}</button>}
          </div>
          {isAdmin && record.config_snapshot_at && <p data-testid="snapshot-date">
            Calculada con los parámetros vigentes el {fmt(record.config_snapshot_at)}.{" "}
            <Link href="/admin#historial-de-cambios" className="nt-link">Parámetros · Historial de cambios</Link>
          </p>}
          {actionError && !confirming && <div className="nt-state error" role="alert"><p>{actionError}</p></div>}
          <QuoteSummaryTable key={record.versionId} {...restored} proposalVersion={record} errors={record.blockingErrors ?? []} invalidRows={[]} />
          {seesProfit && <VersionProfitability scenarios={record.scenarios} />}
          {isCurrent && (
            <section className="nt-section" aria-labelledby="hist-title">
              <h2 id="hist-title">Historial de versiones</h2>
              {versions.isLoading ? <div className="nt-table-wrap" aria-busy="true"><div className="nt-skel" /><div className="nt-skel" /></div>
                : versions.isError || !versions.data ? <div className="nt-state error" role="alert"><p>No se pudo cargar el historial de versiones.</p><button className="nt-btn" onClick={() => void versions.refetch()}>Reintentar</button></div>
                : <div className="nt-table-wrap"><table className="nt-table">
                  <thead><tr><th>VERSIÓN</th><th>FECHA</th><th>USUARIO</th><th>TOTAL MENSUAL ANTES DE IVA</th><th>ACCIONES</th></tr></thead>
                  <tbody>{versions.data.items.map(v => (
                    <tr key={v.id} data-testid={`row-version-${v.versionNumber}`}>
                      <td>v{v.versionNumber}{v.id === versions.data.currentVersionId && " (actual)"}</td>
                      <td>{fmt(v.createdAt)}</td>
                      <td>{v.createdByName}{seesProfit && v.createdByBlocked && <> <span className="nt-badge deleted" data-testid={`status-version-creator-blocked-${v.versionNumber}`}>Usuario bloqueado</span></>}</td>
                      <td className="num">{formatUsd(new Decimal(v.totalMonthlyBeforeTax))}</td>
                      <td><Link className="nt-link" href={`/cotizaciones/${id}/versiones/${v.id}`} data-testid={`link-version-${v.versionNumber}`}>Ver, PDF, Excel y Word</Link></td>
                    </tr>))}</tbody>
                </table></div>}
            </section>
          )}
          {confirming && <DeleteQuoteDialog customer={record.customer} pending={del.isPending} error={actionError} onCancel={() => setConfirming(false)} onConfirm={confirmDelete} />}
        </>
      )}
    </main>
  );
}
