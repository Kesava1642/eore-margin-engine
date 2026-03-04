import prisma from "../db.server";

/**
 * Upsert COGS for a variant in a shop.
 * @param {string} shopId - Shop identifier (e.g. myshop.myshopify.com)
 * @param {string} variantId - Shopify variant GID or stable id
 * @param {string|null} sku - Optional SKU
 * @param {number} cogsPerUnit - Cost per unit (non-negative number)
 * @param {string} [currency] - Optional currency code
 * @returns {Promise<{ id: string, shopId: string, variantId: string, cogsPerUnit: number }>}
 */
export async function upsertCogs(shopId, variantId, sku, cogsPerUnit, currency = null) {
  const value = Number(cogsPerUnit);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("cogsPerUnit must be a non-negative number");
  }
  const row = await prisma.cogs.upsert({
    where: {
      shopId_variantId: { shopId: String(shopId), variantId: String(variantId) },
    },
    update: {
      sku: sku != null ? String(sku) : null,
      cogsPerUnit: value,
      currency: currency != null ? String(currency) : null,
    },
    create: {
      shopId: String(shopId),
      variantId: String(variantId),
      sku: sku != null ? String(sku) : null,
      cogsPerUnit: value,
      currency: currency != null ? String(currency) : null,
    },
  });
  return {
    id: row.id,
    shopId: row.shopId,
    variantId: row.variantId,
    cogsPerUnit: Number(row.cogsPerUnit),
  };
}

/**
 * Get COGS per unit for multiple variants in a shop.
 * @param {string} shopId - Shop identifier
 * @param {string[]} variantIds - List of variant ids to look up
 * @returns {Promise<Map<string, number>>} Map of variantId -> cogsPerUnit (only includes stored variants)
 */
export async function getCogsMap(shopId, variantIds) {
  if (!variantIds?.length) return new Map();
  const list = [...new Set(variantIds)].map((id) => String(id));
  const rows = await prisma.cogs.findMany({
    where: {
      shopId: String(shopId),
      variantId: { in: list },
    },
  });
  const map = new Map();
  for (const r of rows) {
    map.set(r.variantId, Number(r.cogsPerUnit));
  }
  return map;
}

/**
 * Upsert shop fee settings.
 * @param {string} shopId - Shop identifier
 * @param {{ shopifyFeePct?: number, gatewayFeePct?: number, shippingCostPct?: number }} settings - Fee percentages (default 0 if omitted)
 * @returns {Promise<{ shopId: string, shopifyFeePct: number, gatewayFeePct: number, shippingCostPct: number }>}
 */
export async function upsertShopSettings(shopId, settings = {}) {
  const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const shopifyFeePct = toNum(settings.shopifyFeePct);
  const gatewayFeePct = toNum(settings.gatewayFeePct);
  const shippingCostPct = toNum(settings.shippingCostPct);
  const row = await prisma.shopFeeSettings.upsert({
    where: { shopId: String(shopId) },
    update: { shopifyFeePct, gatewayFeePct, shippingCostPct },
    create: {
      shopId: String(shopId),
      shopifyFeePct,
      gatewayFeePct,
      shippingCostPct,
    },
  });
  return {
    shopId: row.shopId,
    shopifyFeePct: Number(row.shopifyFeePct),
    gatewayFeePct: Number(row.gatewayFeePct),
    shippingCostPct: Number(row.shippingCostPct),
  };
}

/**
 * Get shop fee settings by shop id.
 * @param {string} shopId - Shop identifier
 * @returns {Promise<{ shopId: string, shopifyFeePct: number, gatewayFeePct: number, shippingCostPct: number } | null>}
 */
export async function getShopSettings(shopId) {
  const row = await prisma.shopFeeSettings.findUnique({
    where: { shopId: String(shopId) },
  });
  if (!row) return null;
  return {
    shopId: row.shopId,
    shopifyFeePct: Number(row.shopifyFeePct),
    gatewayFeePct: Number(row.gatewayFeePct),
    shippingCostPct: Number(row.shippingCostPct),
  };
}
