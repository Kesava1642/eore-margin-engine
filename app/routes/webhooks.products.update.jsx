/**
 * Webhook: products/update
 * Upsert product and variants by (shop_id, product_id) and (shop_id, variant_id).
 */
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureWebhookShop, toShopifyId, webhookLog } from "../services/webhooks.server";

export const action = async ({ request }) => {
  const webhookId = request.headers.get("X-Shopify-Webhook-Id") ?? undefined;
  let topic, shop, payload;
  try {
    const result = await authenticate.webhook(request);
    topic = result.topic;
    shop = result.shop;
    payload = result.payload;
  } catch (err) {
    webhookLog("error", "products/update", request.headers.get("X-Shopify-Shop-Domain") ?? "unknown", "HMAC validation failed", {
      webhookId,
      result: "error",
      reason: err?.message,
    });
    return new Response(null, { status: 401 });
  }

  try {
    await ensureWebhookShop(shop);
    const productId = toShopifyId(payload?.id);
    if (!productId) {
      webhookLog("error", topic, shop, "missing product id in payload", { webhookId, result: "error" });
      return new Response(null, { status: 400 });
    }

    const updatedAt = payload?.updated_at ? new Date(payload.updated_at) : new Date();
    await prisma.webhookProduct.upsert({
      where: {
        shopId_productId: { shopId: shop, productId },
      },
      update: {
        title: payload?.title ?? null,
        status: payload?.status ?? null,
        updatedAt,
      },
      create: {
        shopId: shop,
        productId,
        title: payload?.title ?? null,
        status: payload?.status ?? null,
        updatedAt,
      },
    });

    const variants = Array.isArray(payload?.variants) ? payload.variants : [];
    for (const v of variants) {
      const variantId = toShopifyId(v?.id);
      if (!variantId) continue;
      await prisma.webhookProductVariant.upsert({
        where: {
          shopId_variantId: { shopId: shop, variantId },
        },
        update: {
          productId,
          sku: v?.sku ?? null,
          title: v?.title ?? null,
          price: v?.price != null ? String(v.price) : null,
          status: v?.status ?? null,
          updatedAt,
        },
        create: {
          shopId: shop,
          variantId,
          productId,
          sku: v?.sku ?? null,
          title: v?.title ?? null,
          price: v?.price != null ? String(v.price) : null,
          status: v?.status ?? null,
          updatedAt,
        },
      });
    }

    webhookLog("info", topic, shop, "success", { webhookId, result: "success", productId, variantCount: variants.length });
    return new Response(null, { status: 200 });
  } catch (err) {
    webhookLog("error", topic, shop, "handler failed", { webhookId, result: "error", reason: err?.message });
    return new Response(null, { status: 500 });
  }
};
