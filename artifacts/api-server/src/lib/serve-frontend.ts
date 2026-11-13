import express, { type Express } from "express";
import path from "node:path";
import { existsSync } from "node:fs";

/** Opt-in: Replit keeps routing the frontend to its own artifact service. */
export function serveFrontend(app: Express, directory?: string) {
  if (!directory) return;
  const root = path.resolve(directory);
  if (!existsSync(path.join(root, "index.html")))
    throw new Error("STATIC_DIR no contiene el frontend compilado (index.html).");
  // Never return SPA HTML for unknown API routes or missing static assets.
  app.use("/api", (_req, res) => { res.status(404).json({ error: "Ruta no encontrada." }); });
  app.use(express.static(root, { index: false, maxAge: 0 }));
  app.get("/{*splat}", (req, res, next) => {
    if (path.extname(req.path)) { next(); return; }
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(root, "index.html"));
  });
}
