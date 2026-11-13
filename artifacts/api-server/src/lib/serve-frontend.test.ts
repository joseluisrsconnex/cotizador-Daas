import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { serveFrontend } from "./serve-frontend";

describe("external same-origin SPA hosting", () => {
  let root: string;
  let server: Server;
  let origin: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "spa-test-"));
    await writeFile(path.join(root, "index.html"), "<html>SPA fixture</html>");
    await writeFile(path.join(root, "asset.js"), "/* asset fixture */");
    const app = express();
    app.get("/api/healthz", (_req, res) => { res.json({ status: "ok" }); });
    serveFrontend(app, root);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No listening port");
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    await rm(root, { recursive: true, force: true });
  });
  it.each(["/", "/sign-in", "/sign-up", "/cotizaciones/saved/version"])("serves SPA at %s", async route => {
    const response = await fetch(origin + route);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain("SPA fixture");
  });
  it("preserves API routes and asset responses", async () => {
    expect(await (await fetch(`${origin}/api/healthz`)).json()).toEqual({ status: "ok" });
    expect(await (await fetch(`${origin}/asset.js`)).text()).toContain("asset fixture");
  });
  it("never substitutes SPA HTML for unknown API routes or missing assets", async () => {
    const api = await fetch(`${origin}/api/missing`);
    expect(api.status).toBe(404);
    expect(api.headers.get("content-type")).toContain("application/json");
    expect((await fetch(`${origin}/missing.js`)).status).toBe(404);
  });
  it("fails explicitly if the frontend build is missing", () => {
    expect(() => serveFrontend(express(), path.join(root, "missing"))).toThrow("STATIC_DIR");
    expect(() => serveFrontend(express(), undefined)).not.toThrow();
  });
});
