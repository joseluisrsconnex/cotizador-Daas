import app from "./app";
import { logger } from "./lib/logger";
import { ensurePricingMigration } from "./lib/pricing-config";
import { ensureQuoteVersionMigration } from "./lib/quote-version-migration";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start() {
  await ensurePricingMigration();
  await ensureQuoteVersionMigration();
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
}

void start().catch(err => {
  logger.error({ err }, "No fue posible completar las migraciones de inicio");
  process.exit(1);
});
