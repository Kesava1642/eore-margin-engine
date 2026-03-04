/**
 * Webhook: app/uninstalled
 * Mark shop uninstalled in WebhookShop, clear sessions, revoke tokens (session delete).
 * HMAC validated by authenticate.webhook(); invalid → 401.
 */
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { webhookLog } from "../services/webhooks.server";

export const action = async ({ request }) => {
  const webhookId = request.headers.get("X-Shopify-Webhook-Id") ?? undefined;
  let topic, shop, session;
  try {
    const result = await authenticate.webhook(request);
    topic = result.topic;
    shop = result.shop;
    session = result.session;
  } catch (err) {
    webhookLog("error", "app/uninstalled", request.headers.get("X-Shopify-Shop-Domain") ?? "unknown", "HMAC validation failed", {
      webhookId,
      result: "error",
      reason: err?.message,
    });
    return new Response(null, { status: 401 });
  }

  try {
    webhookLog("info", topic, shop, "received", { webhookId, result: "success" });

    await prisma.webhookShop.upsert({
      where: { shopId: shop },
      update: { uninstalledAt: new Date(), updatedAt: new Date() },
      create: {
        shopId: shop,
        uninstalledAt: new Date(),
        updatedAt: new Date(),
      },
    });

    if (session) {
      await prisma.session.deleteMany({ where: { shop } });
    }

    webhookLog("info", topic, shop, "success", { webhookId, result: "success", sessionsCleared: !!session });
    return new Response(null, { status: 200 });
  } catch (err) {
    webhookLog("error", topic, shop, "handler failed", { webhookId, result: "error", reason: err?.message });
    return new Response(null, { status: 500 });
  }
};
