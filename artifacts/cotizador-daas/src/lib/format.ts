import type { ExactAmount } from "@workspace/pricing";

export function formatUsd(value: ExactAmount | number | undefined): string {
  if (value === undefined) return "—";
  const [integer, decimals] = value.toFixed(2).split(".");
  const negative = integer.startsWith("-");
  const grouped = integer
    .replace("-", "")
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}USD ${grouped},${decimals}`;
}

export function formatPercent(value: number): string {
  return `${(value * 100).toLocaleString("es-ES", {
    maximumFractionDigits: 2,
  })}%`;
}
