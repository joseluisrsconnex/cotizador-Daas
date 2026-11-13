import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import {
  GetDaasConfigResponse,
  UpdateDaasConfigBody,
  UpdateDaasConfigResponse,
  GetPricingConfigHistoryResponse,
} from "@workspace/api-zod";
import { db, pricingConfigHistoryTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/app-auth";
import { normalizePricingConfig } from "@workspace/pricing/normalization";
import { getPricingConfig, ensurePricingMigration, savePricingConfig, CatalogRetentionError } from "../lib/pricing-config";
import { ASSET_TYPES } from "@workspace/pricing";
import { GetQuoteCatalogResponse } from "@workspace/api-zod";
import {
  validatePricingConfig,
  type PricingConfig,
} from "@workspace/pricing";

const router: IRouter = Router();
router.get("/daas/config/history", requireAdmin, async (_req, res): Promise<void> => {
  await ensurePricingMigration();
  const items = await db.select({
    id: pricingConfigHistoryTable.id, appliedAt: pricingConfigHistoryTable.appliedAt,
    reason: pricingConfigHistoryTable.reason,
  }).from(pricingConfigHistoryTable).orderBy(desc(pricingConfigHistoryTable.appliedAt));
  res.setHeader("Cache-Control", "private, no-store");
  res.json(GetPricingConfigHistoryResponse.parse({ items }));
});

router.get("/daas/catalog", async (_req, res): Promise<void> => {
  const config = await getPricingConfig();
  res.setHeader("Cache-Control", "private, no-store");
  res.json(GetQuoteCatalogResponse.parse({
    assetTypes: ASSET_TYPES,
    servicePackages: config.servicePackages,
    individualServices: config.individualServices.filter(row => row.active),
  }));
});

router.get("/daas/config", requireAdmin, async (_req, res): Promise<void> => {
  const config = await getPricingConfig();
  res.setHeader("Cache-Control", "private, no-store");
  res.json(GetDaasConfigResponse.parse(config));
});

router.put("/daas/config", requireAdmin, async (req, res): Promise<void> => {
  await ensurePricingMigration();
  const parsed = UpdateDaasConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    validatePricingConfig(parsed.data as PricingConfig);
    validatePricingConfig(normalizePricingConfig(parsed.data as PricingConfig));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Configuración inválida.",
    });
    return;
  }
  try {
    const config = await savePricingConfig(parsed.data as PricingConfig);
    res.json(UpdateDaasConfigResponse.parse(config));
  } catch (error) {
    if (error instanceof CatalogRetentionError) {
      res.status(400).json({ error: error.message }); return;
    }
    req.log.error({ errorName: error instanceof Error ? error.name : "Unknown" }, "Pricing save failed");
    res.status(500).json({ error: "No fue posible guardar la configuración." });
  }
});

export default router;
