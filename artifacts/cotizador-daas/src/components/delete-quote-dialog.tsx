import { useEffect, useRef } from "react";

interface Props { customer: string; pending: boolean; error: string; onCancel: () => void; onConfirm: () => void }

export default function DeleteQuoteDialog({ customer, pending, error, onCancel, onConfirm }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (pending) modalRef.current?.focus(); else cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onCancel();
      if (e.key !== "Tab") return;
      const targets = Array.from(modalRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), [tabindex='0']") ?? []);
      if (!targets.length) { e.preventDefault(); modalRef.current?.focus(); return; }
      const first = targets[0], last = targets[targets.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === modalRef.current)) {
        e.preventDefault(); last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus?.(); };
  }, [pending, onCancel]);
  return (
    <div className="nt-modal-back" onClick={() => { if (!pending) onCancel(); }}>
      <div ref={modalRef} tabIndex={-1} className="nt-modal" role="alertdialog" aria-modal="true" aria-labelledby="del-title" onClick={e => e.stopPropagation()} data-testid="dialog-delete">
        <h2 id="del-title">¿Eliminar la cotización de {customer}? Dejará de aparecer en el listado.</h2>
        {error && <p className="field-error" role="alert" data-testid="text-delete-error">{error}</p>}
        <div className="nt-actions">
          <button ref={cancelRef} className="nt-btn ghost" disabled={pending} onClick={onCancel} data-testid="button-cancel-delete">Cancelar</button>
          <button className="nt-btn nt-danger" disabled={pending} onClick={onConfirm} data-testid="button-confirm-delete">{pending ? "Eliminando…" : "Eliminar"}</button>
        </div>
      </div>
    </div>
  );
}
