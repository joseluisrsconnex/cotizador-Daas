import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

/**
 * Run the complete backend suite against empty copies of the current tables.
 * No historical quote, account or pricing row is copied or changed.
 * PGOPTIONS applies the isolated search_path to every Vitest worker connection.
 */
const schema = `quote_suite_${randomUUID().replaceAll("-", "")}`;
let created = false;
try {
  const tables = await pool.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
  );
  const foreignKeys = await pool.query<{ tablename: string; conname: string; definition: string }>(`
    SELECT t.relname AS tablename, c.conname, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE c.contype='f' AND n.nspname='public'
  `);
  const indexes = await pool.query<{ indexdef: string }>(
    "SELECT indexdef FROM pg_indexes WHERE schemaname='public'",
  );
  // All dynamic identifiers came from PostgreSQL, but still quote them.
  const ident = (name: string) => `"${name.replaceAll('"', '""')}"`;
  await pool.query(`CREATE SCHEMA ${ident(schema)}`);
  created = true;
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO ${ident(schema)}`);
    for (const { tablename } of tables.rows)
      await client.query(`CREATE TABLE ${ident(tablename)} (LIKE public.${ident(tablename)} INCLUDING ALL EXCLUDING INDEXES)`);
    // LIKE INCLUDING INDEXES invents names, while the explicit migrations
    // deliberately address their original index names.
    for (const { indexdef } of indexes.rows)
      await client.query(indexdef.replaceAll("public.", `${ident(schema)}.`));
    for (const fk of foreignKeys.rows)
      await client.query(`ALTER TABLE ${ident(fk.tablename)} ADD CONSTRAINT ${ident(fk.conname)} ${fk.definition.replaceAll("public.", `${ident(schema)}.`)}`);
    // Startup's explicit rename must precede any generated-schema queries.
    // Use this same connection so no public table can be selected accidentally.
    const { QUOTE_CODE_MIGRATION } = await import("../lib/quote-code-migration");
    await client.query("BEGIN");
    await client.query(QUOTE_CODE_MIGRATION);
    await client.query("COMMIT");
  } finally { client.release(); }
  const args = process.argv.slice(2);
  const status = await new Promise<number>((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "vitest", "run", "--fileParallelism=false", ...args], {
      cwd: new URL("../..", import.meta.url),
      env: { ...process.env, PGOPTIONS: `-c search_path=${schema}` },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", code => resolve(code ?? 1));
  });
  process.exitCode = status;
} catch (error) {
  logger.error({ error }, "Falló la ejecución de pruebas en un esquema aislado");
  process.exitCode = 1;
} finally {
  if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
  await pool.end();
}
