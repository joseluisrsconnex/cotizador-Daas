import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/** Only numbering, current pointer and missing author-name metadata may change. */
export async function migrateQuoteVersionNumbers() {
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('quote-version-chronological-numbering'))`);
    // Match saveVersion's parent-before-child locking order and block writes
    // while repairing uniqueness. All DDL is transactional and rolls back on error.
    await tx.execute(sql`LOCK TABLE quotes IN SHARE ROW EXCLUSIVE MODE`);
    await tx.execute(sql`LOCK TABLE quote_versions IN ACCESS EXCLUSIVE MODE`);
    await tx.execute(sql`
      UPDATE quote_versions v SET created_by_name = u.name
      FROM app_users u WHERE v.created_by = u.id AND v.created_by_name = ''`);
    const result = await tx.execute(sql`
      SELECT 1 FROM (
        SELECT version_number,
          row_number() OVER (PARTITION BY quote_id ORDER BY created_at, version_number, id) AS expected
        FROM quote_versions
      ) numbered WHERE version_number <> expected LIMIT 1`);
    if (result.rows.length) {
      // Swapping occupied numbers cannot be done with a non-deferrable unique
      // index in place. Keep the exclusive lock through its transactional rebuild.
      await tx.execute(sql`DROP INDEX quote_versions_number_idx`);
      await tx.execute(sql`
        WITH numbered AS (
          SELECT id, row_number() OVER (
            PARTITION BY quote_id ORDER BY created_at, version_number, id
          )::integer AS expected FROM quote_versions
        )
        UPDATE quote_versions v SET version_number = numbered.expected
        FROM numbered WHERE v.id = numbered.id AND v.version_number <> numbered.expected`);
      await tx.execute(sql`CREATE UNIQUE INDEX quote_versions_number_idx ON quote_versions (quote_id, version_number)`);
    }
    await tx.execute(sql`
      WITH latest AS (
        SELECT DISTINCT ON (quote_id) quote_id, id
        FROM quote_versions ORDER BY quote_id, version_number DESC
      )
      UPDATE quotes q SET current_version_id = latest.id
      FROM latest WHERE q.id = latest.quote_id AND q.current_version_id IS DISTINCT FROM latest.id`);
  });
}
