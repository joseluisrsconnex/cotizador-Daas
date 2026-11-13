import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/** Preserve saved canons and snapshots; only derive scenarios and internal Forecast. */
export async function migrateQuoteScenarios() {
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('quote-single-scenario-backfill'))`);
    await tx.execute(sql`
      UPDATE quotes SET scenarios = jsonb_build_array(jsonb_build_object(
        'termMonths', term_months, 'results', results, 'totalMonthlyBeforeTax', total_monthly_before_tax
      )) WHERE scenarios IS NULL`);
    // Derived only from saved amounts, never from today's pricing configuration.
    await tx.execute(sql`
      UPDATE quote_versions SET scenarios = jsonb_build_array(jsonb_build_object(
        'termMonths', term_months, 'results', results, 'totalMonthlyBeforeTax', total_monthly_before_tax
      )) WHERE scenarios IS NULL`);
    // Idempotent correction, including non-null legacy Forecast values.
    // PostgreSQL numeric rounding matches Decimal.ROUND_HALF_UP.
    for (const table of [sql`quotes`, sql`quote_versions`]) {
      await tx.execute(sql`
        WITH derived AS (
          SELECT q.id, (
            SELECT (round((s->>'totalMonthlyBeforeTax')::numeric, 2)
              * (s->>'termMonths')::integer)::text
            FROM jsonb_array_elements(q.scenarios) s
            ORDER BY (s->>'termMonths')::integer LIMIT 1
          ) AS forecast
          FROM ${table} q
        )
        UPDATE ${table} q SET forecast = derived.forecast
        FROM derived WHERE q.id = derived.id
          AND q.forecast IS DISTINCT FROM derived.forecast`);
    }
  });
}
