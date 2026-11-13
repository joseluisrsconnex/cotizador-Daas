import { pool } from "@workspace/db";
import { migrateQuoteCodes } from "../lib/quote-code-migration";
import { ensureQuoteVersionMigration } from "../lib/quote-version-migration";
import { ensurePricingMigration } from "../lib/pricing-config";
import { logger } from "../lib/logger";

try {
  switch (process.argv[2]) {
    case "prepare": {
      // Fresh databases have neither table. Existing ones must rename before
      // schema introspection can mistake the historical column for a drop/add.
      const { rows: [tables] } = await pool.query(
        "SELECT to_regclass('quotes') IS NOT NULL AS quotes, to_regclass('quote_versions') IS NOT NULL AS versions",
      );
      if (tables.quotes !== tables.versions)
        throw new Error("Esquema parcial: restaure el respaldo o revise la migración antes de continuar.");
      if (tables.quotes) await migrateQuoteCodes();
      break;
    }
    case "migrate": await ensureQuoteVersionMigration(); break;
    case "seed": await ensurePricingMigration(); break;
    default: throw new Error("Use prepare, migrate o seed.");
  }
  logger.info("Preparación de despliegue terminada.");
} catch (err) {
  logger.error({ err }, "No se completó la preparación del despliegue.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
