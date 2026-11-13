import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { generateQuoteProposal, getGetSavedQuoteQueryKey, getGetQuoteVersionQueryKey, type SavedQuote, type ProposalDetails } from "@workspace/api-client-react";
import { apiErrorMessage } from "@/lib/api-errors";
import "@/history-auth.css";
import "./proposal-word-dialog.css";

interface Props {
  customer: string;
  version?: SavedQuote;
  resolveVersion?: () => Promise<SavedQuote>;
  initialDetails?: ProposalDetails;
  onGenerated: (details: ProposalDetails) => void;
  onClose: () => void;
}

export default function ProposalWordDialog({ customer, version, resolveVersion, initialDetails, onGenerated, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const queryClient = useQueryClient();
  const [details, setDetails] = useState<ProposalDetails>(() => version?.proposalDetails ?? initialDetails ?? {
    destinatario: "", razonSocial: customer.trim(), sedes: "",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [generatedVersion, setGeneratedVersion] = useState<SavedQuote | undefined>(version);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); previous?.focus(); };
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError("");
    try {
      const record = generatedVersion ?? await resolveVersion?.();
      if (!record) throw new Error("Guarde la cotización para generar la propuesta.");
      setGeneratedVersion(record);
      const body = { destinatario: details.destinatario.trim(), razonSocial: details.razonSocial.trim(), sedes: details.sedes.trim() };
      if (Object.values(body).some(value => !value)) throw new Error("Complete todos los campos.");
      const blob = await generateQuoteProposal(record.id, record.versionId, body, { responseType: "blob" });
      const updated = { ...record, proposalDetails: body };
      queryClient.setQueriesData<SavedQuote>({ queryKey: getGetSavedQuoteQueryKey(record.id) },
        current => current?.versionId === record.versionId ? { ...current, proposalDetails: body } : current);
      queryClient.setQueriesData<SavedQuote>({ queryKey: getGetQuoteVersionQueryKey(record.id, record.versionId) },
        current => current ? { ...current, proposalDetails: body } : current);
      setGeneratedVersion(updated);
      onGenerated(body);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const client = record.customer.replace(/[^\p{L}\p{N} _.-]/gu, "_").slice(0, 120);
      a.download = `Propuesta_DaaS_${client}_v${record.versionNumber}_${new Date().toISOString().slice(0, 10)}.docx`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e, "No se pudo generar la propuesta Word."));
    } finally { setPending(false); }
  };
  return <dialog ref={dialog} className="proposal-dialog" aria-labelledby="proposal-title"
    onCancel={e => { e.preventDefault(); if (!pending) onClose(); }}>
    <form onSubmit={event => void submit(event)}>
      <h2 id="proposal-title">Propuesta Word</h2>
      {!version && <p className="cost-format-note">Se guardará la cotización como una versión antes de generar el documento.</p>}
      <fieldset disabled={pending}>
        <label className="field"><span>Destinatario <b>Obligatorio</b></span><input autoFocus required maxLength={300} value={details.destinatario} onChange={e => setDetails(d => ({ ...d, destinatario: e.target.value }))} /></label>
        <label className="field"><span>Razón social <b>Obligatorio</b></span><input required maxLength={300} value={details.razonSocial} onChange={e => setDetails(d => ({ ...d, razonSocial: e.target.value }))} /></label>
        <label className="field"><span>Sedes / ciudades / cobertura <b>Obligatorio</b></span><textarea required maxLength={2000} rows={3} value={details.sedes} onChange={e => setDetails(d => ({ ...d, sedes: e.target.value }))} /></label>
      </fieldset>
      <p className="quote-validation">Revise el documento y retire las actividades de servicios no contratados antes de enviarlo al cliente.</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="quote-actions">
        <button type="button" className="button secondary" disabled={pending} onClick={onClose}>Cancelar</button>
        <button type="submit" className="button primary" disabled={pending}>{pending ? "Generando Word…" : "Generar Word"}</button>
      </div>
    </form>
  </dialog>;
}
