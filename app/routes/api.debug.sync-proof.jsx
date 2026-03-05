/**
 * GET /api/debug/sync-proof
 * Session-protected. Proves webhook sync + DB-first aggregation for current shop.
 */

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function loader({ request }) {
  const [{ default: prisma }, { authenticate }] = await Promise.all([
    import("../db.server"),
    import("../shopify.server"),
  ]);

  let session;
  try {
    const { session: s } = await authenticate.admin(request);
    session = s;
  } catch {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const shopId = session?.shop?.trim();
  if (!shopId) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  // Webhook row counts
  let orders = 0;
  let lineItems = 0;
  let variants = 0;
  let lastOrderAt = null;

  try {
    const [orderCount, lineItemCount, variantCount, latestOrder] = await Promise.all([
      prisma.webhookOrder.count({ where: { shopId } }),
      prisma.webhookLineItem.count({ where: { shopId } }),
      prisma.webhookProductVariant.count({ where: { shopId } }),
      prisma.webhookOrder.findFirst({
        where: { shopId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);
    orders = orderCount;
    lineItems = lineItemCount;
    variants = variantCount;
    if (latestOrder?.createdAt instanceof Date) {
      lastOrderAt = latestOrder.createdAt.toISOString();
    }
  } catch (e) {
    return jsonResponse(
      {
        shopId,
        error: "Failed to read webhook tables",
        details: e?.message ?? String(e),
      },
      500,
    );
  }

  // DB-first aggregation from WebhookLineItem + WebhookProductVariant
  let dbRows = 0;
  try {
    const [lineItemsDb, variantsDb] = await Promise.all([
      prisma.webhookLineItem.findMany({
        where: { shopId },
        select: {
          variantId: true,
          quantity: true,
          total: true,
          orderId: true,
          sku: true,
          title: true,
          lineItemId: true,
        },
      }),
      prisma.webhookProductVariant.findMany({
        where: { shopId },
        select: {
          variantId: true,
          sku: true,
          title: true,
        },
      }),
    ]);

    const variantMap = new Map();
    for (const v of variantsDb) {
      variantMap.set(v.variantId, {
        sku: v.sku?.trim() || null,
        title: v.title?.trim() || null,
      });
    }

    const agg = new Map();
    for (const li of lineItemsDb) {
      const key = li.variantId ?? `line:${li.lineItemId}`;
      const existing = agg.get(key);
      const variantMeta = li.variantId ? variantMap.get(li.variantId) : null;
      const sku =
        (variantMeta?.sku ?? li.sku?.trim()) ||
        (li.variantId ? `VAR-${String(li.variantId).slice(-6)}` : `LINE-${String(li.lineItemId).slice(-6)}`);
      const title = (variantMeta?.title ?? li.title?.trim()) || "Untitled";
      const qty = Math.max(0, Number(li.quantity) || 0);
      const totalNum = Number(li.total);
      const revenue = Number.isFinite(totalNum) ? totalNum : 0;

      if (existing) {
        existing.quantity += qty;
        existing.revenue += revenue;
      } else {
        agg.set(key, {
          sku,
          title,
          quantity: qty,
          revenue,
        });
      }
    }

    dbRows = agg.size;
  } catch (e) {
    return jsonResponse(
      {
        shopId,
        webhook: { orders, lineItems, variants, lastOrderAt },
        margins: {
          dbRows: 0,
          aggregationSourceExpected: "api-or-empty",
          error: e?.message ?? String(e),
        },
      },
      200,
    );
  }

  const aggregationSourceExpected = dbRows > 0 ? "db" : "api-or-empty";

  return jsonResponse({
    shopId,
    webhook: {
      orders,
      lineItems,
      variants,
      lastOrderAt,
    },
    margins: {
      dbRows,
      aggregationSourceExpected,
    },
  });
}

