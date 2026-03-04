/**
 * GET /api/debug/webhook-stats
 * Session-protected. Returns webhook-synced row counts for the current shop.
 * Use to verify webhook data after triggering order/product events.
 */
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function loader({ request }) {
  let session;
  try {
    const { session: s } = await authenticate.admin(request);
    session = s;
  } catch {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const shopId = session?.shop?.trim();
  if (!shopId) return jsonResponse({ error: "Unauthorized" }, 401);

  try {
    const [webhookShop, webhookOrder, webhookLineItem, webhookProduct, webhookProductVariant] = await Promise.all([
      prisma.webhookShop.count({ where: { shopId } }),
      prisma.webhookOrder.count({ where: { shopId } }),
      prisma.webhookLineItem.count({ where: { shopId } }),
      prisma.webhookProduct.count({ where: { shopId } }),
      prisma.webhookProductVariant.count({ where: { shopId } }),
    ]);

    return jsonResponse({
      shop: shopId,
      WebhookShop: webhookShop,
      WebhookOrder: webhookOrder,
      WebhookLineItem: webhookLineItem,
      WebhookProduct: webhookProduct,
      WebhookProductVariant: webhookProductVariant,
    });
  } catch (e) {
    return jsonResponse({ error: e?.message ?? "Failed to load stats" }, 500);
  }
}
