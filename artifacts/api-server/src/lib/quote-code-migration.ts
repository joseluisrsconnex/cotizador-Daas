import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { APPROVED_QUOTE_CODE_BACKFILL } from "./quote-code-approved-backfill";

/**
 * Explicit, transactional rename. Never run db push to perform this rename:
 * it may interpret it as a dropped column. Invalid legacy identities abort all DDL.
 * Exported SQL also allows exercising the real migration in an isolated schema.
 */
export const QUOTE_CODE_MIGRATION = `
SELECT pg_advisory_xact_lock(hashtext('quote-code-identity-migration'));
LOCK TABLE quotes IN ACCESS EXCLUSIVE MODE;
LOCK TABLE quote_versions IN ACCESS EXCLUSIVE MODE;
DO $migration$
DECLARE t text; issues jsonb;
BEGIN
  FOREACH t IN ARRAY ARRAY['quotes', 'quote_versions'] LOOP
    IF EXISTS (SELECT FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = t AND column_name = 'customer_id') THEN
      IF EXISTS (SELECT FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = t AND column_name = 'quote_code') THEN
        RAISE EXCEPTION 'Ambiguous quote identity columns on %', t;
      END IF;
      EXECUTE format('ALTER TABLE %I RENAME COLUMN customer_id TO quote_code', t);
    END IF;
  END LOOP;
  SELECT jsonb_build_object(
    'duplicates', (SELECT coalesce(jsonb_agg(d), '[]'::jsonb) FROM (
      SELECT lower(quote_code) AS code,
        jsonb_agg(jsonb_build_object('quoteId', id, 'code', quote_code)) AS quotes
      FROM quotes WHERE deleted_at IS NULL GROUP BY lower(quote_code) HAVING count(*) > 1
    ) d),
    'empty', (SELECT coalesce(jsonb_agg(e), '[]'::jsonb) FROM (
      SELECT id AS "quoteId", quote_code AS code FROM quotes
      WHERE quote_code IS NULL OR quote_code !~ '[^[:space:]]'
      UNION ALL
      SELECT quote_id, quote_code FROM quote_versions
      WHERE quote_code IS NULL OR quote_code !~ '[^[:space:]]'
    ) e),
    'versionMismatches', (SELECT coalesce(jsonb_agg(m), '[]'::jsonb) FROM (
      SELECT q.id AS "quoteId", q.quote_code AS code, v.id AS "versionId", v.quote_code AS "versionCode"
      FROM quotes q JOIN quote_versions v ON v.quote_id = q.id
      WHERE q.quote_code IS DISTINCT FROM v.quote_code
    ) m)
  ) INTO issues;
  IF issues <> '{"duplicates":[],"empty":[],"versionMismatches":[]}'::jsonb THEN
    RAISE EXCEPTION 'Cotización ID: migración bloqueada; no se modificó ningún dato ni restricción.'
      USING DETAIL = issues::text;
  END IF;
END $migration$;
ALTER TABLE quotes ALTER COLUMN quote_code DROP DEFAULT;
ALTER TABLE quote_versions ALTER COLUMN quote_code DROP DEFAULT;
ALTER TABLE quotes ALTER COLUMN quote_code SET NOT NULL;
ALTER TABLE quote_versions ALTER COLUMN quote_code SET NOT NULL;
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_code_required;
ALTER TABLE quotes ADD CONSTRAINT quotes_code_required CHECK (quote_code ~ '[^[:space:]]');
ALTER TABLE quote_versions DROP CONSTRAINT IF EXISTS quote_versions_code_required;
ALTER TABLE quote_versions ADD CONSTRAINT quote_versions_code_required CHECK (quote_code ~ '[^[:space:]]');
DROP INDEX IF EXISTS quotes_active_code_idx;
CREATE UNIQUE INDEX quotes_active_code_idx ON quotes (lower(quote_code)) WHERE deleted_at IS NULL;

-- Identity metadata belongs to the parent, not to a pricing snapshot.
-- Renaming it changes no historical amounts, dates, authors, or configuration.
CREATE OR REPLACE FUNCTION enforce_quote_version_code() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE parent_code text;
BEGIN
  SELECT quote_code INTO parent_code FROM quotes WHERE id = NEW.quote_id FOR SHARE;
  IF parent_code IS DISTINCT FROM NEW.quote_code THEN
    RAISE EXCEPTION 'Todas las versiones deben compartir Cotización ID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS quote_version_code_identity ON quote_versions;
CREATE TRIGGER quote_version_code_identity BEFORE INSERT OR UPDATE OF quote_id, quote_code ON quote_versions
FOR EACH ROW EXECUTE FUNCTION enforce_quote_version_code();
CREATE OR REPLACE FUNCTION propagate_quote_code() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE quote_versions SET quote_code = NEW.quote_code
    WHERE quote_id = NEW.id AND quote_code IS DISTINCT FROM NEW.quote_code;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS quote_code_identity ON quotes;
CREATE TRIGGER quote_code_identity AFTER UPDATE OF quote_code ON quotes
FOR EACH ROW WHEN (OLD.quote_code IS DISTINCT FROM NEW.quote_code) EXECUTE FUNCTION propagate_quote_code();
`;

export class QuoteCodeMigrationError extends Error {
  constructor(readonly conflicts: unknown) {
    super("Cotización ID: migración bloqueada; revise los IDs y las cotizaciones del informe de conflictos. No se aplicaron cambios.");
    this.name = "QuoteCodeMigrationError";
  }
}

export async function migrateQuoteCodes() {
  try {
    await db.transaction(async tx => {
      await tx.execute(sql.raw(APPROVED_QUOTE_CODE_BACKFILL));
      await tx.execute(sql.raw(QUOTE_CODE_MIGRATION));
    });
  } catch (error) {
    // Preserve PostgreSQL DETAIL at the outer error level: structured loggers
    // otherwise drop the affected IDs from a nested Drizzle cause.
    let cause: unknown = error;
    while (cause && typeof cause === "object") {
      const pg = cause as { code?: string; detail?: string; cause?: unknown };
      if (pg.code === "P0001" && pg.detail) {
        let conflicts: unknown;
        try { conflicts = JSON.parse(pg.detail); } catch { throw error; }
        throw new QuoteCodeMigrationError(conflicts);
      }
      cause = pg.cause;
    }
    throw error;
  }
}
