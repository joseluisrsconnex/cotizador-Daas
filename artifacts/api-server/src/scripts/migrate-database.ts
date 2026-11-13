import { spawn } from "node:child_process";
import { logger } from "../lib/logger";
import { schemaPushSucceeded } from "../lib/migration-result";

async function run(args: string[], verifySchemaResult = false): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const child = spawn("pnpm", args, {
      cwd: new URL("../../../../", import.meta.url),
      // Intentionally noninteractive: schema changes needing confirmation must
      // be reviewed separately, never implicitly accepted by automation.
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", chunk => { output += chunk; process.stdout.write(chunk); });
    child.stderr.on("data", chunk => { output += chunk; process.stderr.write(chunk); });
    child.once("error", reject);
    child.once("exit", code => {
      // drizzle-kit 0.31 can exit zero after a non-TTY prompt error. Do not
      // continue to data migrations unless a positive schema result was emitted.
      if (code !== 0 || (verifySchemaResult && !schemaPushSucceeded(output))) {
        reject(new Error("No se confirmó la sincronización del esquema. Revise la salida y aplique cualquier cambio interactivo solo tras respaldo y revisión; no use --force."));
      } else resolve();
    });
  });
}

try {
  await run(["--filter", "@workspace/api-server", "run", "deploy:prepare"]);
  await run(["--filter", "@workspace/db", "run", "push"], true);
  await run(["--filter", "@workspace/api-server", "run", "deploy:migrate"]);
} catch (err) {
  logger.error({ err }, "Migración detenida antes de continuar.");
  process.exitCode = 1;
}
