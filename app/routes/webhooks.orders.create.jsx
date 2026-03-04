/**
 * Webhook: orders/create
 * HMAC validated by authenticate.webhook(); invalid requests throw → 401.
 * Idempotent: upsert order + line items by (shop_id, order_id) and (shop_id, line_item_id).
 */
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureWebhookShop, toShopifyId, webhookLog } from "../services/webhooks.server";

export const action = async ({ request }) => {
  let topic, shop, payload;
  try {
    const result = await authenticate.webhook(request);
    topic = result.topic;
    shop = result.shop;
    payload = result.payload;
  } catch (err) {
    webhookLog("error", "orders/create", request.headers.get("X-Shopify-Shop-Domain") ?? "unknown", "HMAC validation failed", {
      reason: err?.message,
    });
    return new Response(null, { status: 401 });
  }

  try {
    await ensureWebhookShop(shop);
    const orderId = toShopifyId(payload?.id);
    if (!orderId) {
      webhookLog("error", topic, shop, "missing order id in payload");
      return new Response(null, { status: 400 });
    }

    const createdAt = payload?.created_at ? new Date(payload.created_at) : null;
    await prisma.webhookOrder.upsert({
      where: {
        shopId_orderId: { shopId: shop, orderId },
      },
      update: {
        totalPrice: payload?.total_price ?? null,
        subtotalPrice: payload?.subtotal_price ?? null,
        totalTax: payload?.total_tax ?? null,
        currency: payload?.currency ?? null,
        financialStatus: payload?.financial_status ?? null,
        createdAt,
        updatedAt: new Date(),
      },
      create: {
        shopId: shop,
        orderId,
        totalPrice: payload?.total_price ?? null,
        subtotalPrice: payload?.subtotal_price ?? null,
        totalTax: payload?.total_tax ?? null,
        currency: payload?.currency ?? null,
        financialStatus: payload?.financial_status ?? null,
        createdAt,
        updatedAt: new Date(),
      },
    });

    const lineItems = Array.isArray(payload?.line_items) ? payload.line_items : [];
    for (const li of lineItems) {
      const lineItemId = toShopifyId(li?.id);
      if (!lineItemId) continue;
      await prisma.webhookLineItem.upsert({
        where: {
          shopId_lineItemId: { shopId: shop, lineItemId },
        },
        update: {
          orderId,
          variantId: li?.variant_id != null ? toShopifyId(li.variant_id) : null,
          productId: li?.product_id != null ? toShopifyId(li.product_id) : null,
          sku: li?.sku ?? null,
          title: li?.title ?? null,
          quantity: Math.max(0, parseInt(li?.quantity, 10) || 0),
          price: li?.price != null ? String(li.price) : null,
          total: li?.price != null && li?.quantity != null ? String(Number(li.price) * (parseInt(li.quantity, 10) || 0)) : null,
        },
        create: {
          shopId: shop,
          orderId,
          lineItemId,
          variantId: li?.variant_id != null ? toShopifyId(li.variant_id) : null,
          productId: li?.product_id != null ? toShopifyId(li.product_id) : null,
          sku: li?.sku ?? null,
          title: li?.title ?? null,
          quantity: Math.max(0, parseInt(li?.quantity, 10) || 0),
          price: li?.price != null ? String(li.price) : null,
          total: li?.price != null && li?.quantity != null ? String(Number(li.price) * (parseInt(li.quantity, 10) || 0)) : null,
        },
      });
    }

    webhookLog("info", topic, shop, "success", { orderId, lineItemCount: lineItems.length });
    return new Response(null, { status: 200 });
  } catch (err) {
    webhookLog("error", topic, shop, "handler failed", { reason: err?.message });
    return new Response(null, { status: 500 });
  }
};
