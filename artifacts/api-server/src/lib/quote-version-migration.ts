import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { migrateQuoteScenarios } from "./quote-scenario-migration";
import { migrateQuoteVersionNumbers } from "./quote-numbering-migration";
import { migrateQuoteCodes } from "./quote-code-migration";

/** Data only: managed db push / Publish applies schema before this migration. */
export async function ensureQuoteVersionMigration() {
  await migrateQuoteCodes();
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('quote-version-one-backfill'))`);
    await tx.execute(sql`
      INSERT INTO quote_versions (
        id, quote_id, version_number, request_id, customer, quote_code, term_months, package_type,
        rows, results, total_monthly_before_tax, config_snapshot, margin, created_by, created_at
      )
      SELECT gen_random_uuid(), q.id, 1, q.request_id, q.customer, q.quote_code, q.term_months, q.package_type,
        q.rows, q.results, q.total_monthly_before_tax, q.config_snapshot, q.margin, q.owner_id, q.created_at
      FROM quotes q WHERE q.current_version_id IS NULL
      ON CONFLICT (quote_id, version_number) DO NOTHING`);
    await tx.execute(sql`
      UPDATE quotes q SET current_version_id = v.id, updated_at = q.created_at
      FROM quote_versions v
      WHERE v.quote_id = q.id AND v.version_number = 1 AND q.current_version_id IS NULL`);
  });
  await migrateQuoteScenarios();
  await migrateQuoteVersionNumbers();
}
