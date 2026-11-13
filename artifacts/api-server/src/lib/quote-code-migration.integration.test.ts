import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import { QUOTE_CODE_MIGRATION } from "./quote-code-migration";
import { APPROVED_QUOTE_CODE_BACKFILL } from "./quote-code-approved-backfill";

afterAll(async () => { await pool.end(); });

async function connect() { return pool.connect(); }
async function fixture(run: (client: Awaited<ReturnType<typeof connect>>) => Promise<void>) {
  const client = await pool.connect();
  const schema = `quote_code_test_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE quotes (
        id text PRIMARY KEY, owner_id text, customer_id text NOT NULL DEFAULT '',
        deleted_at timestamptz, amounts jsonb, scenarios jsonb, config_snapshot jsonb
      );
      CREATE TABLE quote_versions (
        id text PRIMARY KEY, quote_id text REFERENCES quotes(id), customer_id text NOT NULL DEFAULT '',
        amounts jsonb, scenarios jsonb, config_snapshot jsonb
      );
      INSERT INTO quotes VALUES ('q1', 'owner1', 'Keep-Á-001', NULL,
        '{"monthly":"1234.56"}', '[{"term":36,"total":"1234.56"}]', '{"rate":0.018}');
      INSERT INTO quote_versions VALUES ('v1', 'q1', 'Keep-Á-001',
        '{"monthly":"1234.56"}', '[{"term":36,"total":"1234.56"}]', '{"rate":0.018}');
      INSERT INTO quote_versions SELECT 'v2', quote_id, customer_id, amounts, scenarios, config_snapshot FROM quote_versions WHERE id='v1';
    `);
    await run(client);
  } finally {
    await client.query("ROLLBACK");
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    client.release();
  }
}

describe("Migración explícita de Cotización ID, aislada de los datos reales", () => {
  it("corrige solo los IDs vacíos autorizados, conserva todo lo demás y es repetible", async () => {
    await fixture(async client => {
      const id = "0a8819ae-e690-4f6c-8a0d-a22df12edd33";
      await client.query("INSERT INTO quotes(id,customer_id,amounts) VALUES ($1,'','{\"total\":\"456.78\"}')", [id]);
      await client.query("INSERT INTO quote_versions(id,quote_id,customer_id,amounts) VALUES ('approved-version',$1,'','{\"total\":\"456.78\"}')", [id]);
      const before = (await client.query("SELECT to_jsonb(q) AS data FROM quotes q ORDER BY id")).rows;
      await client.query("BEGIN");
      await client.query(APPROVED_QUOTE_CODE_BACKFILL);
      await client.query(QUOTE_CODE_MIGRATION);
      await client.query("COMMIT");
      const after = (await client.query("SELECT to_jsonb(q) AS data FROM quotes q ORDER BY id")).rows;
      expect(after).toEqual(before.map(({data: {customer_id, ...rest}}) => ({
        data: { ...rest, quote_code: rest.id === id ? "HIST-0001" : customer_id },
      })));
      expect((await client.query("SELECT quote_code,amounts FROM quote_versions WHERE id='approved-version'")).rows)
        .toEqual([{quote_code:"HIST-0001",amounts:{total:"456.78"}}]);
      // A subsequent explicit edit must never be reset to the invented ID.
      await client.query("UPDATE quotes SET quote_code='User-edited' WHERE id=$1", [id]);
      await client.query("BEGIN");
      await client.query(APPROVED_QUOTE_CODE_BACKFILL);
      await client.query(QUOTE_CODE_MIGRATION);
      await client.query("COMMIT");
      expect((await client.query("SELECT quote_code FROM quotes WHERE id=$1",[id])).rows)
        .toEqual([{quote_code:"User-edited"}]);
    });
  });

  it("revierte también la corrección autorizada si el ID reservado está ocupado", async () => {
    await fixture(async client => {
      const id = "0a8819ae-e690-4f6c-8a0d-a22df12edd33";
      await client.query("INSERT INTO quotes(id,customer_id) VALUES ($1,''),('occupied','hist-0001')", [id]);
      await client.query("BEGIN");
      await client.query(APPROVED_QUOTE_CODE_BACKFILL);
      await expect(client.query(QUOTE_CODE_MIGRATION)).rejects.toMatchObject({ code:"P0001" });
      await client.query("ROLLBACK");
      expect((await client.query("SELECT customer_id FROM quotes WHERE id=$1",[id])).rows)
        .toEqual([{customer_id:""}]);
    });
  });

  it("renombra ambas columnas sin tocar valores ni importes, es repetible y protege la identidad compartida", async () => {
    await fixture(async client => {
      const before = (await client.query("SELECT to_jsonb(q) AS data FROM quotes q")).rows;
      const versions = (await client.query("SELECT to_jsonb(v) AS data FROM quote_versions v ORDER BY id")).rows;
      await client.query("BEGIN");
      await client.query(QUOTE_CODE_MIGRATION);
      await client.query("COMMIT");
      for (let attempt = 0; attempt < 2; attempt++) {
        const after = (await client.query("SELECT to_jsonb(q) AS data FROM quotes q")).rows;
        expect(after).toEqual(before.map(({ data: { customer_id, ...rest } }) => ({ data: { ...rest, quote_code: customer_id } })));
        const afterVersions = (await client.query("SELECT to_jsonb(v) AS data FROM quote_versions v ORDER BY id")).rows;
        expect(afterVersions).toEqual(versions.map(({ data: { customer_id, ...rest } }) => ({ data: { ...rest, quote_code: customer_id } })));
        await client.query("BEGIN");
        await client.query(QUOTE_CODE_MIGRATION);
        await client.query("COMMIT");
      }
      await expect(client.query("INSERT INTO quotes(id,quote_code) VALUES ('q2','keep-á-001')")).rejects.toMatchObject({ code: "23505" });
      await expect(client.query("INSERT INTO quotes(id,quote_code) VALUES ('q3','  ')")).rejects.toMatchObject({ code: "23514" });
      await expect(client.query("INSERT INTO quotes(id) VALUES ('q4')")).rejects.toMatchObject({ code: "23502" });
      await expect(client.query("UPDATE quote_versions SET quote_code='unrelated' WHERE id='v1'")).rejects.toMatchObject({ code: "23514" });
      await client.query("UPDATE quotes SET quote_code='Renamed' WHERE id='q1'");
      expect((await client.query("SELECT quote_code FROM quote_versions")).rows).toEqual([{ quote_code: "Renamed" }, { quote_code: "Renamed" }]);
    });
  });

  for (const issue of ["duplicates", "empty", "versionMismatches"] as const) {
    it(`informa ${issue} y revierte todo sin instalar restricciones parciales`, async () => {
      await fixture(async client => {
        if (issue === "duplicates") await client.query("INSERT INTO quotes(id,owner_id,customer_id) VALUES ('q2','other','keep-á-001')");
        if (issue === "empty") await client.query("INSERT INTO quotes(id,customer_id,deleted_at) VALUES ('q2','  ',now())");
        if (issue === "versionMismatches") await client.query("UPDATE quote_versions SET customer_id='Other' WHERE id='v1'");
        const before = (await client.query("SELECT to_jsonb(q) AS data FROM quotes q ORDER BY id")).rows;
        await client.query("BEGIN");
        let failure: any;
        try { await client.query(QUOTE_CODE_MIGRATION); } catch (error) { failure = error; }
        expect(failure?.message).toContain("migración bloqueada");
        const report = JSON.parse(failure.detail);
        expect(report[issue].length).toBeGreaterThan(0);
        expect(JSON.stringify(report)).toContain(issue === "versionMismatches" ? "v1" : "q2");
        await client.query("ROLLBACK");
        expect((await client.query("SELECT to_jsonb(q) AS data FROM quotes q ORDER BY id")).rows).toEqual(before);
        expect((await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND column_name='quote_code'")).rows).toEqual([]);
        expect((await client.query("SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND indexname='quotes_active_code_idx'")).rows).toEqual([]);
      });
    });
  }
});
