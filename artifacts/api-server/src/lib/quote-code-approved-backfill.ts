/**
 * User-authorized, one-time correction of exactly three blank historical IDs.
 * This is NOT a policy to invent identifiers for arbitrary legacy quotations.
 * Keep it in the same transaction as the rename so merging into an environment
 * with the original records cannot leave either correction partially applied.
 */
export const APPROVED_QUOTE_CODE_BACKFILL = `
SELECT pg_advisory_xact_lock(hashtext('quote-code-identity-migration'));
LOCK TABLE quotes IN ACCESS EXCLUSIVE MODE;
LOCK TABLE quote_versions IN ACCESS EXCLUSIVE MODE;
DO $approved$
DECLARE identity_column text; version_column text; approved record; changed integer;
BEGIN
  SELECT column_name INTO identity_column FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'quotes'
      AND column_name IN ('customer_id', 'quote_code')
    ORDER BY column_name LIMIT 1;
  SELECT column_name INTO version_column FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'quote_versions'
      AND column_name IN ('customer_id', 'quote_code')
    ORDER BY column_name LIMIT 1;
  IF identity_column IS NULL OR version_column IS NULL THEN
    RAISE EXCEPTION 'No se encontraron las columnas del identificador histórico';
  END IF;
  FOR approved IN SELECT * FROM (VALUES
    ('0a8819ae-e690-4f6c-8a0d-a22df12edd33', 'HIST-0001'),
    ('1cae6981-a9af-4553-bce2-4bbb847fc834', 'HIST-0002'),
    ('7074c1fe-d154-48e4-b918-d4098f75937c', 'HIST-0003')
  ) AS authorized(quote_id, code) LOOP
    EXECUTE format('UPDATE quotes SET %I = $1 WHERE id::text = $2 AND %I !~ ''[^[:space:]]''',
      identity_column, identity_column) USING approved.code, approved.quote_id;
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed = 1 THEN
      EXECUTE format('UPDATE quote_versions SET %I = $1 WHERE quote_id::text = $2 AND %I !~ ''[^[:space:]]''',
        version_column, version_column) USING approved.code, approved.quote_id;
    END IF;
  END LOOP;
END $approved$;
`;
