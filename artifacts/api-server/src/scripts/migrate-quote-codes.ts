import { pool } from "@workspace/db";
import { migrateQuoteCodes } from "../lib/quote-code-migration";
import { logger } from "../lib/logger";

try {
  await migrateQuoteCodes();
  logger.info("Cotización ID: migración aplicada y restricción de unicidad instalada.");
} catch (err) {
  logger.error({ err }, "Cotización ID: migración no aplicada; revise los conflictos históricos informados.");
  process.exitCode = 1;
} finally { await pool.end(); }
