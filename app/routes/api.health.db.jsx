/**
 * GET /api/health/db
 * Session-protected. Returns DB connection status and presence of required tables.
 * Use for production release verification.
 */
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const REQUIRED_TABLES = [
  "WebhookShop",
  "WebhookOrder",
  "WebhookLineItem",
  "WebhookProduct",
  "WebhookProductVariant",
  "Cogs",
  "ShopFeeSettings",
];

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
  const shop = session?.shop?.trim();
  if (!shop) return jsonResponse({ error: "Unauthorized" }, 401);

  let dbConnected = false;
  const tablesPresent = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbConnected = true;
  } catch {
    return jsonResponse(
      { shop, dbConnected: false, tablesPresent: REQUIRED_TABLES.reduce((acc, t) => ({ ...acc, [t]: false }), {}) },
      200,
    );
  }

  const models = [
    { key: "WebhookShop", fn: () => prisma.webhookShop.count() },
    { key: "WebhookOrder", fn: () => prisma.webhookOrder.count() },
    { key: "WebhookLineItem", fn: () => prisma.webhookLineItem.count() },
    { key: "WebhookProduct", fn: () => prisma.webhookProduct.count() },
    { key: "WebhookProductVariant", fn: () => prisma.webhookProductVariant.count() },
    { key: "Cogs", fn: () => prisma.cogs.count() },
    { key: "ShopFeeSettings", fn: () => prisma.shopFeeSettings.count() },
  ];
  for (const { key, fn } of models) {
    try {
      await fn();
      tablesPresent[key] = true;
    } catch {
      tablesPresent[key] = false;
    }
  }

  return jsonResponse({
    shop,
    dbConnected: true,
    tablesPresent,
  });
}
