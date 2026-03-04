/**
 * Webhook helpers: ensure shop record exists, structured logging for Railway.
 * HMAC validation is performed by authenticate.webhook(request) before handlers run.
 */

import prisma from "../db.server";

const LOG_PREFIX = "[EORE Webhook]";

/**
 * Log webhook event for Railway. Include topic, shop, webhookId (if available), and result.
 * @param {string} level - "info" | "error"
 * @param {string} topic - e.g. orders/create
 * @param {string} shop - shop domain
 * @param {string} message - short message
 * @param {{ webhookId?: string, result?: "success" | "error", [k: string]: unknown }} meta - optional meta (result, webhookId, orderId, etc.)
 */
export function webhookLog(level, topic, shop, message, meta = {}) {
  const { webhookId, result, ...rest } = meta;
  const out = { topic, shop, message, result: result ?? (level === "error" ? "error" : "success"), ...(webhookId != null ? { webhookId } : {}), ...rest };
  const line = `${LOG_PREFIX} ${level} topic=${topic} shop=${shop}${webhookId != null ? ` webhookId=${webhookId}` : ""} result=${out.result} ${message}`;
  if (level === "error") {
    console.error(line, rest);
  } else {
    console.log(line, Object.keys(rest).length ? rest : "");
  }
}

/**
 * Ensure WebhookShop exists for the given shop domain (idempotent).
 * @param {string} shopId - Shop domain, e.g. store.myshopify.com
 * @returns {Promise<WebhookShop>}
 */
export async function ensureWebhookShop(shopId) {
  if (!shopId || typeof shopId !== "string") throw new Error("shopId required");
  const shop = await prisma.webhookShop.upsert({
    where: { shopId: shopId.trim() },
    update: { updatedAt: new Date() },
    create: {
      shopId: shopId.trim(),
      updatedAt: new Date(),
    },
  });
  return shop;
}

/**
 * Normalize Shopify ID to string (strip GID prefix if present for consistent storage).
 * @param {string|number} id - Shopify ID or GID
 * @returns {string}
 */
export function toShopifyId(id) {
  if (id == null) return "";
  const s = String(id).trim();
  const match = s.match(/\/(\d+)$/);
  return match ? match[1] : s;
}
