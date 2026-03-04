/**
 * Webhook helpers: ensure shop record exists, structured logging for Railway.
 * HMAC validation is performed by authenticate.webhook(request) before handlers run.
 */

import prisma from "../db.server";

const LOG_PREFIX = "[EORE Webhook]";

export function webhookLog(level, topic, shop, message, meta = {}) {
  const payload = { topic, shop, message, ...meta };
  const line = `${LOG_PREFIX} ${level} topic=${topic} shop=${shop} ${message}`;
  if (level === "error") {
    console.error(line, meta);
  } else {
    console.log(line, Object.keys(meta).length ? meta : "");
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
