import type { TermMonths } from "@workspace/pricing";
import { warrantyMessage } from "@/lib/quote-validation";

/** `term` is the shortest selected period; nothing renders when no period is selected. */
export default function WarrantyNotice({ term }: { term: TermMonths | undefined }) {
  if (term === undefined) return null;
  return <p className="warranty-notice" data-testid="warranty-notice" role="note">{warrantyMessage(term)}</p>;
}
