# Novotechno · Cotizador DaaS

Cotizador comercial en español de equipos y servicios Device as a Service, con configuración financiera persistente en PostgreSQL.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server through its managed workflow
- `pnpm --filter @workspace/cotizador-daas run dev` — run the web app through its managed workflow
- `pnpm --filter @workspace/pricing test` — run Vitest for the pure pricing engine, including the 12/36-month reference cases with absolute ±0.01 USD tolerance
- `pnpm --filter @workspace/cotizador-daas test` — verify quote input validation
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `shared/pricing.ts` — pure pricing engine and initial financial parameters, exported as `@workspace/pricing`.
- `artifacts/cotizador-daas/src/pages/` — quote and administration screens.
- `lib/api-spec/openapi.yaml` — configuration API contract; regenerate clients after changes.
- `lib/db/src/schema/pricing-configs.ts` — central pricing configuration persistence.

## Architecture decisions

- All financial formulas use the same pure `decimal.js` engine. Monetary amounts are rounded only for display.
- Spare is calculated independently for each row, even when asset types repeat; follow the supplied formula exactly.
- Service package costs are financed per unit over the selected term, not charged as fixed monthly costs. Their residual is always zero and not editable.
- Administrative parameters are saved centrally. Quote editing creates a new version using current pricing; every earlier version retains its immutable results and full internal parameter snapshot. Never recalculate historical versions.
- Clerk authentication protects quoting. Commercial users can view, edit and soft-delete only their own quotes; administrators can manage any quote, restore deleted quotes and edit pricing. Unauthorized mutations return 403.

## Product

- Unlimited add/duplicate/delete reference rows, server-backed term/package previews, and a per-reference canon table before IVA.
- Configurable placement rate, spare bases, residuals, minimum margins, and service package costs/details.
- Saved quotes have version history, read-only historical detail and version/date in PDF/Excel exports. Duplicates are independent quotes starting at version 1.
- Never send configuration snapshots in quote responses. Only admins receive saved per-scenario profitability (income, total cost, net profit, net margin and state). Commercial responses omit all profitability fields; exports omit them for every role.
- Persist placement, residual and minimum-margin fractions rounded to six decimals. Normalize only the live configuration; historical quote snapshots must remain unchanged.
- Quote deletion is logical only. Deleted quotes are hidden by default; only administrators can show deleted quotes and restore them.

## User preferences

- Spanish interface and USD display with "." thousands and "," decimals.
- All prices use the single commercial margin, independent of the period's profitability thresholds. Compare the scenario's net P&G margin with Mínimo / Objetivo / Rentable: below minimum blocks save/export with 422; below objective is permitted and marked for admins. Never re-evaluate old versions against current settings.
- Preserve the existing calculation structure and historical quote results when updating current pricing.
- Quotes require a customer name, at least one complete reference row, and an explicitly selected service package. Any invalid row blocks the entire quote, not just that row.
- Equipment costs are strictly positive USD decimal numbers, without currency symbols/codes or thousands separators; accept either comma or point for decimals, and do not silently sanitize invalid input.
- Manufacturer warranty reminders are informative, never blocking, and use the operation's month count in reference input, quote output, and exported PDF.
- Brand identity: Novotechno, primary #6D31FA. Use the supplied purple NTS / white Novotechno Servicios lockup in `client/public/brand/` throughout the app; place it on a dark backing when the surrounding surface is light.
- All future PDF exports must include the Novotechno logo in the quote header, matching the existing canon-summary header.

## Gotchas

- Use the existing managed artifact workflows; they provide the required port and path environment.
- Invalid or unfinished quote rows show pending amounts, never synthetic zero pricing.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
