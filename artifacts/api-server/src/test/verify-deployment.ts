/**
 * Opt-in deployment smoke test. Creates/drops ONLY its own temporary database.
 * Requires CREATEDB on a development/test PostgreSQL instance, never production.
 */
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const database = `deployment_check_${randomUUID().replaceAll("-", "")}`;
const cwd = new URL("../../../../", import.meta.url);
const connection = new URL(process.env.DATABASE_URL!);
connection.pathname = `/${database}`;
const env = { ...process.env, DATABASE_URL: connection.toString(), NODE_ENV: "production" };
let created = false;
let server: ChildProcess | undefined;

function run(args: string[], childEnv = env): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", args, { cwd, env: childEnv, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Command failed: pnpm ${args.join(" ")}`)));
  });
}

try {
  await pool.query(`CREATE DATABASE "${database}"`);
  created = true;
  await run(["db:migrate"]);
  await run(["db:seed"]);
  // Use a process against the disposable database to assert repeated seed
  // retains an operator edit, without ever connecting writes to the source DB.
  await run(["--filter", "@workspace/scripts", "exec", "tsx",
    "../artifacts/api-server/src/test/verify-seed.ts"], env);
  await run(["db:migrate"]);
  await run(["db:seed"]);
  await run(["--filter", "@workspace/scripts", "exec", "tsx",
    "../artifacts/api-server/src/test/verify-seed.ts", "check"], env);

  const listener = createServer();
  await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  await new Promise<void>(resolve => listener.close(() => resolve()));
  server = spawn(process.execPath, ["dist/index.mjs"], {
    cwd: new URL("../..", import.meta.url),
    env: {
      ...env, PORT: String(address.port), CLERK_PROXY_ENABLED: "false",
      STATIC_DIR: "../cotizador-daas/dist/public",
    },
    stdio: "inherit",
  });
  const origin = `http://127.0.0.1:${address.port}`;
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error("Production server exited before readiness");
    try { ready = (await fetch(`${origin}/api/healthz`)).ok; } catch { /* readiness wait */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error("Production server readiness timeout");
  for (const route of ["/", "/sign-in", "/cotizaciones/example"]) {
    const response = await fetch(origin + route);
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("text/html"))
      throw new Error(`SPA route failed: ${route}`);
  }
  const protectedResponse = await fetch(`${origin}/api/auth/me`, { redirect: "manual" });
  if (protectedResponse.status !== 401) throw new Error("Anonymous API access must remain 401");
  logger.info("Verificados: base nueva, migración repetida, seed conservador, arranque compilado, SPA y API protegida.");
} catch (err) {
  logger.error({ err }, "Falló la verificación de entrega externa.");
  process.exitCode = 1;
} finally {
  if (server && server.exitCode === null) {
    const stopped = new Promise<void>(resolve => server!.once("exit", () => resolve()));
    server.kill("SIGTERM");
    await stopped;
  }
  if (created) await pool.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await pool.end();
}
