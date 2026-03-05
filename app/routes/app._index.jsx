import { useCallback, useMemo, useState, useRef } from "react";
import { useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { computeRowMargin } from "../lib/margin";

const DEFAULT_CURRENCY = "USD";
const WARN_MARGIN_PCT = 10;

function formatCurrency(value, currency = DEFAULT_CURRENCY) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
    Number(value) || 0,
  );
}

const ORDERS_QUERY = `#graphql
  query OrdersWithLineItems($query: String) {
    orders(first: 100, query: $query) {
      edges {
        node {
          id
          createdAt
          lineItems(first: 250) {
            edges {
              node {
                id
                title
                quantity
                originalTotalSet {
                  shopMoney {
                    amount
                  }
                }
                variant {
                  id
                  sku
                }
                product {
                  id
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
      }
    }
  }
`;

function formatDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function last6(str) {
  if (str == null || typeof str !== "string") return "";
  return str.length <= 6 ? str : str.slice(-6);
}

function normalizedTitle(title) {
  if (title == null || typeof title !== "string") return "";
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

function getStableKeyAndSku(line, orderId, index) {
  const title = line.title || "Untitled";
  const normTitle = normalizedTitle(title);
  const variantId = line.variant?.id ?? null;
  const variantSku = line.variant?.sku?.trim();
  if (variantSku) return { key: `sku:${variantSku}`, displaySku: variantSku, variantId };
  if (variantId) return { key: `variant:${variantId}`, displaySku: `VAR-${last6(variantId)}`, variantId };
  const productId = line.product?.id;
  if (productId) return { key: `product:${productId}:${normTitle}`, displaySku: `PROD-${last6(productId)}`, variantId: null };
  const lineItemId = line.id;
  if (lineItemId) return { key: `line:${lineItemId}`, displaySku: `LINE-${last6(lineItemId)}`, variantId: null };
  return { key: `fallback:${orderId}:${normTitle}:${index}`, displaySku: `UNK-${index + 1}`, variantId: null };
}

function isPcdBlockedError(message) {
  if (typeof message !== "string") return false;
  const lower = message.toLowerCase();
  return lower.includes("not approved to access the order object") || lower.includes("protected customer data");
}

function aggregateOrdersToRows(ordersEdges) {
  const agg = new Map();
  let lineItemsParsed = 0;
  let firstOrderId = null;
  let firstLineItem = null;
  for (const { node: order } of ordersEdges) {
    if (!firstOrderId) firstOrderId = order.id;
    const lineEdges = order.lineItems?.edges ?? [];
    let lineIndex = 0;
    for (const { node: line } of lineEdges) {
      lineItemsParsed += 1;
      const { key, displaySku, variantId } = getStableKeyAndSku(line, order.id, lineIndex);
      lineIndex += 1;
      const title = line.title || "Untitled";
      const qty = Math.max(0, Number(line.quantity) || 0);
      const amountStr = line.originalTotalSet?.shopMoney?.amount ?? "0";
      const revenue = Number(amountStr) || 0;
      if (!firstLineItem) firstLineItem = { sku: displaySku, title, qty, revenue };
      const existing = agg.get(key);
      if (existing) {
        existing.quantity += qty;
        existing.revenue += revenue;
        existing.orderIds.add(order.id);
      } else {
        agg.set(key, { sku: displaySku, title, quantity: qty, revenue, orderIds: new Set([order.id]), variantId: variantId ?? null });
      }
    }
  }
  const rows = Array.from(agg.values()).map((r) => ({
    sku: r.sku,
    title: r.title,
    quantity: r.quantity,
    orderCount: r.orderIds.size,
    revenue: Math.round(r.revenue * 100) / 100,
    variantId: r.variantId ?? undefined,
  }));
  return { rows, lineItemsParsed, firstOrderId, firstLineItem, ordersCount: ordersEdges.length };
}

const ADMIN_API_VERSION = "2025-01";

async function fetchOrdersWithCustomToken(shopDomain, accessToken, query) {
  const url = `https://${shopDomain.replace(/^https?:\/\//, "").split("/")[0]}/admin/api/${ADMIN_API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
    body: JSON.stringify({ query: ORDERS_QUERY, variables: { query } }),
  });
  const status = res.status;
  let data = null;
  let errors = null;
  let graphqlError = null;
  try {
    const json = await res.json();
    data = json.data ?? null;
    errors = json.errors ?? null;
    if (errors?.length) graphqlError = typeof errors[0]?.message === "string" ? errors[0].message : "Unknown GraphQL error";
  } catch {
    graphqlError = "Failed to parse response JSON";
  }
  return { data, errors, status, graphqlError };
}

const DEFAULT_FEE_SETTINGS = { shopifyFeePct: 0, gatewayFeePct: 0, shippingCostPct: 0 };

function makeDebug(opts) {
  return {
    authMode: opts.authMode ?? "session",
    hasShopDomain: opts.hasShopDomain ?? false,
    hasAdminToken: opts.hasAdminToken ?? false,
    tokenAttempted: opts.tokenAttempted ?? false,
    tokenHttpStatus: opts.tokenHttpStatus ?? null,
    tokenGraphqlError: opts.tokenGraphqlError ?? null,
  };
}

export const action = async ({ request }) => {
  if (request.method !== "POST") return { ok: false, error: "Method not allowed" };
  const [{ default: prisma }, { authenticate }] = await Promise.all([
    import("../db.server"),
    import("../shopify.server"),
  ]);
  try {
    const { session } = await authenticate.admin(request);
    const shop = session?.shop?.trim();
    if (!shop) return { ok: false, error: "Missing shop" };
    const formData = await request.formData();
    if (formData.get("intent") !== "save_cogs") return { ok: false, error: "Invalid intent" };
    const sku = formData.get("sku");
    if (typeof sku !== "string" || !sku.trim()) return { ok: false, error: "sku is required" };
    const skuTrim = sku.trim();
    const title = formData.get("title");
    const titleVal = typeof title === "string" ? title.trim() || null : null;
    const cogsUnitRaw = formData.get("cogsUnit");
    const cogsUnitNum = cogsUnitRaw !== null && cogsUnitRaw !== "" ? Number(cogsUnitRaw) : 0;
    if (!Number.isFinite(cogsUnitNum) || cogsUnitNum < 0) return { ok: false, error: "cogsUnit must be a non-negative number" };
    await prisma.skuCost.upsert({
      where: { shop_sku: { shop, sku: skuTrim } },
      update: { cogsUnit: cogsUnitNum, title: titleVal },
      create: { shop, sku: skuTrim, title: titleVal, cogsUnit: cogsUnitNum },
    });
    return { ok: true, sku: skuTrim, cogsUnit: cogsUnitNum, savedAt: new Date().toISOString() };
  } catch (e) {
    return { ok: false, error: e?.message ?? "Failed to save COGS" };
  }
};

export const loader = async ({ request }) => {
  const [{ default: prisma }, { getCogsMap, getShopSettings }, { authenticate }] = await Promise.all([
    import("../db.server"),
    import("../services/shop-data.server"),
    import("../shopify.server"),
  ]);
  async function getLastSkuCostRows(shop) {
    if (!shop || typeof shop !== "string") return [];
    try {
      const rows = await prisma.skuCost.findMany({
        where: { shop: shop.trim() },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: { sku: true, cogsUnit: true, updatedAt: true },
      });
      return rows.map((r) => ({ sku: r.sku, cogsUnit: Number(r.cogsUnit), updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt) }));
    } catch {
      return [];
    }
  }
  async function getDebugDb(shop) {
    const dbUrl = process.env.DATABASE_URL || "(sqlite default)";
    let skuCostRowCount = null;
    let lastSkuCostRows = [];
    if (shop && typeof shop === "string") {
      try {
        skuCostRowCount = await prisma.skuCost.count({ where: { shop: shop.trim() } });
        lastSkuCostRows = await getLastSkuCostRows(shop);
      } catch {
        skuCostRowCount = null;
        lastSkuCostRows = [];
      }
    }
    return { dbUrl, skuCostRowCount, lastSkuCostRows };
  }
  async function mergeSavedCogsIntoRows(shopId, rows) {
    if (!shopId || !Array.isArray(rows)) return { rowsWithCogs: rows ?? [], savedCogsBySku: {} };
    const variantIds = rows.map((r) => r.variantId).filter(Boolean);
    const cogsMap = await getCogsMap(shopId, variantIds);
    const rowsWithCogs = rows.map((r) => ({ ...r, cogsPerUnit: r.variantId ? (cogsMap.get(r.variantId) ?? 0) : 0 }));
    const savedCogsBySku = Object.fromEntries(rowsWithCogs.map((r) => [r.sku, r.cogsPerUnit]));
    return { rowsWithCogs, savedCogsBySku };
  }

  /** DB-first: aggregate margin rows from WebhookLineItem + WebhookProductVariant. */
  async function aggregateFromWebhookDb(shopId) {
    const [lineItems, variants] = await Promise.all([
      prisma.webhookLineItem.findMany({
        where: { shopId },
        select: { variantId: true, quantity: true, total: true, orderId: true, sku: true, title: true, lineItemId: true },
      }),
      prisma.webhookProductVariant.findMany({
        where: { shopId },
        select: { variantId: true, sku: true, title: true },
      }),
    ]);
    const variantMap = new Map();
    for (const v of variants) {
      variantMap.set(v.variantId, { sku: v.sku?.trim() || null, title: v.title?.trim() || null });
    }
    const agg = new Map();
    let lineItemsParsed = 0;
    const orderIds = new Set();
    for (const line of lineItems) {
      lineItemsParsed += 1;
      orderIds.add(line.orderId);
      const key = line.variantId ?? `line:${line.lineItemId}`;
      const totalNum = Number(line.total);
      const revenue = Number.isFinite(totalNum) ? totalNum : 0;
      const qty = Math.max(0, Number(line.quantity) || 0);
      const existing = agg.get(key);
      const variantMeta = line.variantId ? variantMap.get(line.variantId) : null;
      const sku = (variantMeta?.sku ?? line.sku?.trim()) || (line.variantId ? `VAR-${last6(line.variantId)}` : `LINE-${last6(line.lineItemId)}`);
      const title = (variantMeta?.title ?? line.title?.trim()) || "Untitled";
      if (existing) {
        existing.quantity += qty;
        existing.revenue += revenue;
        existing.orderIds.add(line.orderId);
      } else {
        agg.set(key, {
          sku,
          title,
          quantity: qty,
          revenue,
          orderIds: new Set([line.orderId]),
          variantId: line.variantId ?? undefined,
        });
      }
    }
    const rows = Array.from(agg.values()).map((r) => ({
      sku: r.sku,
      title: r.title,
      quantity: r.quantity,
      orderCount: r.orderIds.size,
      revenue: Math.round(r.revenue * 100) / 100,
      variantId: r.variantId,
    }));
    return { rows, lineItemsParsed, ordersCount: orderIds.size };
  }

  let sessionShop = null;
  let admin = null;
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
    sessionShop = auth.session?.shop?.trim() ?? null;
    if (!sessionShop) {
      const debugDb = await getDebugDb(null);
      return { ok: false, shop: null, error: { message: "Missing shop", hint: "Session invalid." }, counts: { ordersFetched: 0, lineItemsParsed: 0, skuRows: 0 }, preview: {}, rows: [], savedCogsBySku: {}, shopFeeSettings: DEFAULT_FEE_SETTINGS, debug: { db: debugDb } };
    }

    const aggregationStart = Date.now();
    const dbAgg = await aggregateFromWebhookDb(sessionShop);
    const aggregationMs = Date.now() - aggregationStart;

    if (dbAgg.rows.length > 0) {
      const { rowsWithCogs, savedCogsBySku } = await mergeSavedCogsIntoRows(sessionShop, dbAgg.rows);
      const shopFeeSettings = (await getShopSettings(sessionShop)) ?? DEFAULT_FEE_SETTINGS;
      const debugDb = await getDebugDb(sessionShop);
      console.log(
        `[EORE] margin aggregation shop=${sessionShop} source=db rows=${dbAgg.rows.length} ms=${aggregationMs}`,
      );
      return {
        ok: true,
        shop: sessionShop,
        aggregationSource: "db",
        counts: { ordersFetched: dbAgg.ordersCount, lineItemsParsed: dbAgg.lineItemsParsed, skuRows: dbAgg.rows.length },
        preview: {},
        rows: rowsWithCogs,
        savedCogsBySku,
        shopFeeSettings,
        debug: { authMode: "session", db: debugDb, aggregationMs },
      };
    }

    console.log(`[EORE] margin aggregation shop=${sessionShop} source=empty rows=0 ms=${aggregationMs}`);
    const hasShopDomain = Boolean(process.env.SHOPIFY_SHOP_DOMAIN && String(process.env.SHOPIFY_SHOP_DOMAIN).trim());
    const hasAdminToken = Boolean(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN && String(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN).trim());
    const missingEnvHint = `Missing env: SHOPIFY_SHOP_DOMAIN=${hasShopDomain ? "present" : "missing"}, SHOPIFY_ADMIN_ACCESS_TOKEN=${hasAdminToken ? "present" : "missing"}. Add them to .env (see docs/DEV_CUSTOM_APP_TOKEN.md) and restart dev.`;
    const tokenFailedHint = "Token fallback failed. Check token, scopes, and shop domain (see docs/DEV_CUSTOM_APP_TOKEN.md).";
    const pcdDocLine = "See docs/SHOPIFY_ORDERS_ACCESS.md for the single correct path (Production approval vs Dev token).";
    const query = `created_at:>=${formatDateDaysAgo(30)}`;

    const response = await admin.graphql(ORDERS_QUERY, { variables: { query } });
    const json = await response.json();
    if (json.errors?.length) {
      const message = json.errors.map((e) => e.message).join(", ");
      if (isPcdBlockedError(message)) {
        const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN?.trim();
        const accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim();
        if (shopDomain && accessToken) {
          const result = await fetchOrdersWithCustomToken(shopDomain, accessToken, query);
          const tokenAttempted = true;
          const tokenHttpStatus = result.status;
          const tokenGraphqlError = result.graphqlError;
          if (result.errors?.length) {
            const debugDb = await getDebugDb(shopDomain);
            return { ok: false, shop: shopDomain, error: { message: result.errors.map((e) => e.message).join(", "), hint: `${tokenFailedHint} ${pcdDocLine}` }, counts: { ordersFetched: 0, lineItemsParsed: 0, skuRows: 0 }, preview: {}, rows: [], savedCogsBySku: {}, shopFeeSettings: DEFAULT_FEE_SETTINGS, debug: { ...makeDebug({ authMode: "blocked", hasShopDomain, hasAdminToken, tokenAttempted, tokenHttpStatus, tokenGraphqlError }), db: debugDb } };
          }
          const ordersEdges = result.data?.orders?.edges ?? [];
          const agg = aggregateOrdersToRows(ordersEdges);
          const { rowsWithCogs, savedCogsBySku } = await mergeSavedCogsIntoRows(shopDomain, agg.rows);
          const debugDb = await getDebugDb(shopDomain);
          const shopFeeSettings = (await getShopSettings(shopDomain)) ?? DEFAULT_FEE_SETTINGS;
          if (rowsWithCogs.length === 0) {
            return { ok: true, shop: shopDomain, aggregationSource: "db", emptyStateWebhook: true, counts: { ordersFetched: 0, lineItemsParsed: 0, skuRows: 0 }, preview: {}, rows: [], savedCogsBySku: {}, shopFeeSettings, debug: { ...makeDebug({ authMode: "token-fallback", hasShopDomain, hasAdminToken, tokenAttempted, tokenHttpStatus, tokenGraphqlError: null }), db: debugDb } };
          }
          return { ok: true, shop: shopDomain, aggregationSource: "api", authMode: "token-fallback", counts: { ordersFetched: agg.ordersCount, lineItemsParsed: agg.lineItemsParsed, skuRows: agg.rows.length }, preview: { firstOrderId: agg.firstOrderId, firstLineItem: agg.firstLineItem }, rows: rowsWithCogs, savedCogsBySku, shopFeeSettings, debug: { ...makeDebug({ authMode: "token-fallback", hasShopDomain, hasAdminToken, tokenAttempted, tokenHttpStatus, tokenGraphqlError: null }), db: debugDb } };
        }
        const debugDb = await getDebugDb(sessionShop);
        return { ok: false, shop: sessionShop, error: { message, hint: `${missingEnvHint} ${pcdDocLine}` }, counts: { ordersFetched: 0, lineItemsParsed: 0, skuRows: 0 }, preview: {}, rows: [], savedCogsBySku: {}, shopFeeSettings: DEFAULT_FEE_SETTINGS, debug: { ...makeDebug({ authMode: "blocked", hasShopDomain, hasAdminToken, tokenAttempted: false, tokenHttpStatus: null, tokenGraphqlError: null }), db: debugDb } };
      }
      const debugDb = await getDebugDb(sessionShop);
      return { ok: false, shop: sessionShop, error: { message, hint: "Check Admin API permissions and query." }, counts: { ordersFetched: 0, lineItemsParsed: 0, skuRows: 0 }, preview: {}, rows: [], savedCogsBySku: {}, shopFeeSettings: DEFAULT_FEE_SETTINGS, debug: { ...makeDebug({ authMode: "session", hasShopDomain, hasAdminToken }), db: debugDb } };
    }
    const ordersEdges = json.data?.orders?.edges ?? [];
    const agg = aggregateOrdersToRows(ordersEdges);
    const { rowsWithCogs, savedCogsBySku } = await mergeSavedCogsIntoRows(sessionShop, agg.rows);
    const debugDb = await getDebugDb(sessionShop);
    const shopFeeSettings = (await getShopSettings(sessionShop)) ?? DEFAULT_FEE_SETTINGS;
    if (rowsWithCogs.length === 0) {
      return { ok: true, shop: sessionShop, aggregationSource: "db", emptyStateWebhook: true, counts: { ordersFetched: 0, lineItemsParsed: 0, skuRows: 0 }, preview: {}, rows: [], savedCogsBySku: {}, shopFeeSettings, debug: { ...makeDebug({ authMode: "session", hasShopDomain, hasAdminToken }), db: debugDb } };
    }
    return { ok: true, shop: sessionShop, aggregationSource: "api", authMode: "session", counts: { ordersFetched: agg.ordersCount, lineItemsParsed: agg.lineItemsParsed, skuRows: agg.rows.length }, preview: { firstOrderId: agg.firstOrderId, firstLineItem: agg.firstLineItem }, rows: rowsWithCogs, savedCogsBySku, shopFeeSettings, debug: { ...makeDebug({ authMode: "session", hasShopDomain, hasAdminToken }), db: debugDb } };
  } catch (e) {
    const message = e?.message ?? "Unknown error";
    if (isPcdBlockedError(message)) {
      const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN?.trim();
      const accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim();
      if (shopDomain && accessToken) {
        let tokenAttempted = false;
        let tokenHttpStatus = null;
        let tokenGraphqlError = null;
        try {
          const result = await fetchOrdersWithCustomToken(shopDomain, accessToken, query);
          tokenAttempted = true;
          tokenHttpStatus = result.status;
          tokenGraphqlError = result.graphqlError;
          if (!result.errors?.length) {
            const ordersEdges = result.data?.orders?.edges ?? [];
            const agg = aggregateOrdersToRows(ordersEdges);
            const { rowsWithCogs, savedCogsBySku } = await mergeSavedCogsIntoRows(shopDomain, agg.rows);
            const debugDb = await getDebugDb(shopDomain);
            const shopFeeSettings = (await getShopSettings(shopDomain)) ?? DEFAULT_FEE_SETTINGS;
            if (rowsWithCogs.length === 0) {
              return { ok: true, shop: shopDomain, aggregationSource: "db", emptyStateWebhook: true, counts: { ordersFetched: 0, lineItemsParsed: 0, skuRows: 0 }, preview: {}, rows: [], savedCogsBySku: {}, shopFeeSettings, debug: { ...makeDebug({ authMode: "token-fallback", hasShopDomain, hasAdminToken, tokenAttempted, tokenHttpStatus, tokenGraphqlError: null }), db: debugDb } };
            }
            return { ok: true, shop: shopDomain, aggregationSource: "api", authMode: "token-fallback", counts: { ordersFetched: agg.ordersCount, lineItemsParsed: agg.lineItemsParsed, skuRows: agg.rows.length }, preview: { firstOrderId: agg.firstOrderId, firstLineItem: agg.firstLineItem }, rows: rowsWithCogs, savedCogsBySku, shopFeeSettings, debug: { ...makeDebug({ authMode: "token-fallback", hasShopDomain, hasAdminToken, tokenAttempted, tokenHttpStatus, tokenGraphqlError: null }), db: debugDb } };
          }
        } catch {
          tokenAttempted = true;
        }
        const debugDbCatch1 = await getDebugDb(sessionShop ?? null);
        return { ok: false, shop: sessionShop ?? null, error: { message, hint: `${tokenFailedHint} ${pcdDocLine}` }, counts: { ordersFetched: 0, lineItemsParsed: 0, skuRows: 0 }, preview: {}, rows: [], savedCogsBySku: {}, shopFeeSettings: DEFAULT_FEE_SETTINGS, debug: { ...makeDebug({ authMode: "blocked", hasShopDomain, hasAdminToken, tokenAttempted, tokenHttpStatus, tokenGraphqlError }), db: debugDbCatch1 } };
      }
      const debugDbCatch2 = await getDebugDb(sessionShop ?? null);
      return { ok: false, shop: sessionShop ?? null, error: { message, hint: `${missingEnvHint} ${pcdDocLine}` }, counts: { ordersFetched: 0, lineItemsParsed: 0, skuRows: 0 }, preview: {}, rows: [], savedCogsBySku: {}, shopFeeSettings: DEFAULT_FEE_SETTINGS, debug: { ...makeDebug({ authMode: "blocked", hasShopDomain, hasAdminToken, tokenAttempted: false, tokenHttpStatus: null, tokenGraphqlError: null }), db: debugDbCatch2 } };
    }
    const debugDbCatch3 = await getDebugDb(sessionShop ?? null);
    return { ok: false, shop: sessionShop ?? null, error: { message, hint: "Admin API may be unavailable or session invalid." }, counts: { ordersFetched: 0, lineItemsParsed: 0, skuRows: 0 }, preview: {}, rows: [], savedCogsBySku: {}, shopFeeSettings: DEFAULT_FEE_SETTINGS, debug: { ...makeDebug({ authMode: "session", hasShopDomain, hasAdminToken }), db: debugDbCatch3 } };
  }
};

function getDefaultFeePct(shopFeeSettings) {
  if (!shopFeeSettings || typeof shopFeeSettings !== "object") return 3;
  const a = Number(shopFeeSettings.shopifyFeePct) || 0;
  const b = Number(shopFeeSettings.gatewayFeePct) || 0;
  const c = Number(shopFeeSettings.shippingCostPct) || 0;
  const sum = a + b + c;
  return sum > 0 ? sum : 3;
}

export default function Index() {
  const loaderData = useLoaderData?.() ?? {};
  const [feePercent, setFeePercent] = useState(() => getDefaultFeePct(loaderData.shopFeeSettings));
  const [cogsBySku, setCogsBySku] = useState(() => loaderData.savedCogsBySku ?? {});
  const [lastUpdated] = useState(() => new Date().toISOString());
  const [savedSkuAt, setSavedSkuAt] = useState({});
  const [errorBySku, setErrorBySku] = useState({});
  const [lastSave, setLastSave] = useState(null);
  const [savingSku, setSavingSku] = useState(null);
  const [toastError, setToastError] = useState(null);
  const navigation = useNavigation();
  const lastSubmitSkuRef = useRef(null);

  const handleSaveCogs = useCallback(async (row, cogsUnit) => {
    const sku = row.sku;
    const variantId = row.variantId;
    if (!variantId) {
      setToastError("Cannot save COGS: row has no variant ID");
      return;
    }
    lastSubmitSkuRef.current = sku;
    setSavingSku(sku);
    setErrorBySku((prev) => ({ ...prev, [sku]: undefined }));
    try {
      const res = await fetch("/api/cogs", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variantId,
          sku: row.sku,
          cogsPerUnit: Number(cogsUnit) || 0,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error ?? "Save failed";
        setErrorBySku((prev) => ({ ...prev, [sku]: msg }));
        setToastError(msg);
        return;
      }
      setCogsBySku((prev) => ({ ...prev, [sku]: Number(cogsUnit) || 0 }));
      setSavedSkuAt((prev) => ({ ...prev, [sku]: Date.now() }));
      setTimeout(() => setSavedSkuAt((prev) => ({ ...prev, [sku]: undefined })), 3000);
    } finally {
      setSavingSku(null);
      lastSubmitSkuRef.current = null;
    }
  }, []);

  const updateCogs = useCallback((sku, value) => {
    const num = value === "" ? 0 : Number(value);
    setCogsBySku((prev) => (Number.isNaN(num) ? prev : { ...prev, [sku]: num }));
  }, []);

  const shopCurrency = loaderData.shopCurrency ?? DEFAULT_CURRENCY;

  const tableRows = useMemo(() => {
    const rows = loaderData.rows ?? [];
    const totalFeePct = Number(feePercent) || 0;
    return rows.map((r) => {
      const revenue = Number(r.revenue) || 0;
      const qty = Number(r.quantity) || 0;
      const cogsPerUnit = cogsBySku[r.sku] ?? 0;
      const { cogsTotal, fees, netProfit, marginPct } = computeRowMargin(
        revenue,
        qty,
        cogsPerUnit,
        totalFeePct,
      );
      const isLossMaking = netProfit < 0;
      const isLowMargin = revenue > 0 && marginPct < 10;
      const isHighFees = revenue > 0 && revenue !== 0 && (fees / revenue) * 100 > 6;
      const isSaving = savingSku === r.sku;
      const savedAt = savedSkuAt[r.sku];
      const rowError = errorBySku[r.sku];
      return {
        ...r,
        id: r.sku,
        _revenue: revenue,
        _fees: fees,
        _netProfit: netProfit,
        _marginPct: marginPct,
        isLossMaking,
        isLowMargin,
        isHighFees,
        revenueFormatted: formatCurrency(revenue, shopCurrency),
        feesFormatted: formatCurrency(fees, shopCurrency),
        netProfitFormatted: formatCurrency(netProfit, shopCurrency),
        marginPercentFormatted: `${marginPct.toFixed(1)}%`,
        cogsPerUnit,
        isSaving,
        savedAt,
        rowError,
      };
    });
  }, [
    loaderData.rows,
    loaderData.shopCurrency,
    feePercent,
    cogsBySku,
    savingSku,
    savedSkuAt,
    errorBySku,
  ]);

  const [sortKey, setSortKey] = useState("marginPct");
  const [sortDir, setSortDir] = useState("desc");

  const sortedRows = useMemo(() => {
    const key = sortKey === "marginPercent" ? "_marginPct" : sortKey === "netProfit" ? "_netProfit" : "_revenue";
    return [...tableRows].sort((a, b) => {
      const va = a[key] ?? 0;
      const vb = b[key] ?? 0;
      const d = va - vb;
      return sortDir === "asc" ? d : -d;
    });
  }, [tableRows, sortKey, sortDir]);

  const insights = useMemo(() => {
    if (!tableRows.length) {
      return {
        totalRevenue: 0,
        totalFees: 0,
        totalNetProfit: 0,
        avgMarginPct: 0,
        lossCount: 0,
        topLossSkus: [],
        topLowMarginSkus: [],
      };
    }
    let totalRevenue = 0;
    let totalFees = 0;
    let totalNetProfit = 0;
    let lossCount = 0;
    for (const row of tableRows) {
      const rev = row._revenue ?? 0;
      totalRevenue += rev;
      totalFees += row._fees ?? 0;
      totalNetProfit += row._netProfit ?? 0;
      if (row._netProfit < 0) lossCount += 1;
    }
    const weightedMarginNumerator = tableRows.reduce(
      (sum, row) => sum + (row._marginPct ?? 0) * (row._revenue ?? 0),
      0,
    );
    const avgMarginPct =
      totalRevenue > 0 ? weightedMarginNumerator / totalRevenue : 0;

    const topLossSkus = [...tableRows]
      .filter((r) => typeof r._netProfit === "number")
      .sort((a, b) => (a._netProfit ?? 0) - (b._netProfit ?? 0))
      .slice(0, 5)
      .map((r) => ({
        sku: r.sku,
        netProfit: r._netProfit ?? 0,
        marginPct: r._marginPct ?? 0,
      }));

    const topLowMarginSkus = [...tableRows]
      .filter((r) => typeof r._marginPct === "number")
      .sort((a, b) => (a._marginPct ?? 0) - (b._marginPct ?? 0))
      .slice(0, 5)
      .map((r) => ({
        sku: r.sku,
        netProfit: r._netProfit ?? 0,
        marginPct: r._marginPct ?? 0,
      }));

    return {
      totalRevenue,
      totalFees,
      totalNetProfit,
      avgMarginPct,
      lossCount,
      topLossSkus,
      topLowMarginSkus,
    };
  }, [tableRows]);

  const toggleSort = useCallback((key) => {
    setSortKey(key);
    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
  }, []);

  const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV === true;
  const { ok, shop, error, authMode, counts = {}, preview = {}, rows: rawRows = [], debug = {} } = loaderData;
  const debugDb = debug?.db ?? {};
  const dbUrl = debugDb.dbUrl ?? "—";
  const skuCostRowCount = debugDb.skuCostRowCount != null ? String(debugDb.skuCostRowCount) : "—";
  const lastSkuCostRows = Array.isArray(debugDb.lastSkuCostRows) ? debugDb.lastSkuCostRows : [];
  const hasRows = ok && rawRows.length > 0;
  const emptyStateWebhook = ok && loaderData.emptyStateWebhook === true;
  const zeroOrders = ok && !emptyStateWebhook && (counts.ordersFetched ?? 0) === 0;

  const safeRows = Array.isArray(sortedRows) ? sortedRows : [];
  const aggregationSource = loaderData.aggregationSource ?? "unknown";
  // eslint-disable-next-line no-console
  console.log("[EORE UI] render start", { rows: safeRows.length, source: aggregationSource });

  return (
    <ErrorBoundary>
      <s-page heading="Margin engine">
        {isDev && (
        <s-section heading="Debug (dev only)">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="tight">
              <s-text>
                <strong>Connection:</strong> {shop ? `${shop} · Admin API ${ok ? "ok" : "error"}` : "—"}
                {error && (
                  <span style={{ color: "var(--p-color-text-critical, #d72c0d)" }}>
                    {" "}
                    {error.message}
                  </span>
                )}
              </s-text>
              <s-text>
                <strong>Auth mode:</strong> {debug.authMode ?? authMode ?? "—"}
              </s-text>
              <s-text>
                <strong>Env:</strong> SHOPIFY_SHOP_DOMAIN={debug.hasShopDomain ? "present" : "missing"},
                SHOPIFY_ADMIN_ACCESS_TOKEN={debug.hasAdminToken ? "present" : "missing"}
              </s-text>
              {debug.tokenAttempted && (
                <s-text>
                  <strong>Token fallback:</strong> attempted, HTTP {debug.tokenHttpStatus ?? "—"}, GraphQL error:{" "}
                  {debug.tokenGraphqlError ?? "none"}
                </s-text>
              )}
              <s-text>
                <strong>Counts:</strong> ordersFetched={counts.ordersFetched ?? 0}, lineItemsParsed=
                {counts.lineItemsParsed ?? 0}, skuRows={counts.skuRows ?? 0}
                {loaderData.aggregationSource != null && ` · source=${loaderData.aggregationSource}`}
              </s-text>
              {preview.firstOrderId && (
                <s-text>
                  <strong>Preview:</strong> firstOrderId={String(preview.firstOrderId).replace("gid://shopify/Order/", "")}
                  {preview.firstLineItem && (
                    <>
                      {" "}
                      · firstLineItem: sku={preview.firstLineItem.sku}, title={preview.firstLineItem.title}, qty=
                      {preview.firstLineItem.qty}, revenue={preview.firstLineItem.revenue}
                    </>
                  )}
                </s-text>
              )}
              <s-text>
                <strong>lastUpdated:</strong> {lastUpdated}
              </s-text>
              <s-text>
                <strong>DB:</strong> {dbUrl}
              </s-text>
              <s-text>
                <strong>SkuCost rows (this shop):</strong> {skuCostRowCount}
              </s-text>
              {lastSave && (
                <s-text>
                  <strong>Last save:</strong> {lastSave.sku} @ {lastSave.savedAt}
                </s-text>
              )}
            </s-stack>
          </s-box>
        </s-section>
      )}

      {isDev && (
        <s-section heading="COGS Debug">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="tight">
              <s-text>
                <strong>Last 5 saved COGS:</strong>
              </s-text>
              {lastSkuCostRows.length === 0 ? (
                <s-text tone="subdued">None for this shop.</s-text>
              ) : (
                <s-stack direction="block" gap="tight">
                  {lastSkuCostRows.map((row, i) => (
                    <s-text key={i}>
                      {row.sku} — {row.cogsUnit} — {row.updatedAt}
                    </s-text>
                  ))}
                </s-stack>
              )}
            </s-stack>
          </s-box>
        </s-section>
      )}

      <s-section heading="Margin table">
        <PolarisPage title="Margin engine" backAction={{ content: "Home", url: "/app" }}>
          {navigation.state === "loading" && (
            <PolarisSkeletonPage>
              <PolarisCard>
                <Card.Section>
                  <PolarisSkeletonBodyText lines={3} />
                  <PolarisSkeletonDisplayText size="small" />
                </Card.Section>
              </PolarisCard>
            </PolarisSkeletonPage>
          )}

          {navigation.state !== "loading" && (
            <>
              <PolarisCard>
                <div style={{ padding: "16px", display: "flex", alignItems: "center", gap: 16 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Fee %</span>
                    <PolarisTextField
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      value={String(feePercent)}
                      onChange={(v) => setFeePercent(Number(v) || 0)}
                      autoComplete="off"
                      label=""
                      labelHidden
                    />
                  </label>
                </div>
              </PolarisCard>

              {hasRows && (
                <PolarisCard>
                  <Card.Section title="Insights">
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 12 }}>
                      <div>
                        <p><strong>Total revenue</strong></p>
                        <p>{formatCurrency(insights.totalRevenue, shopCurrency)}</p>
                      </div>
                      <div>
                        <p><strong>Total fees</strong></p>
                        <p>{formatCurrency(insights.totalFees, shopCurrency)}</p>
                      </div>
                      <div>
                        <p><strong>Total net profit</strong></p>
                        <p>{formatCurrency(insights.totalNetProfit, shopCurrency)}</p>
                      </div>
                      <div>
                        <p><strong>Avg margin %</strong></p>
                        <p>{insights.avgMarginPct.toFixed(1)}%</p>
                      </div>
                      <div>
                        <p><strong>Loss-making SKUs</strong></p>
                        <p>{insights.lossCount}</p>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 32 }}>
                      <div style={{ minWidth: 200 }}>
                        <p><strong>Top 5 loss-making SKUs</strong></p>
                        {insights.topLossSkus.length === 0 ? (
                          <p style={{ color: "var(--p-color-text-subdued)" }}>None</p>
                        ) : (
                          <ul style={{ paddingLeft: 16, margin: 0 }}>
                            {insights.topLossSkus.map((item) => (
                              <li key={`loss-${item.sku}`}>
                                {item.sku} · {formatCurrency(item.netProfit, shopCurrency)} ·{" "}
                                {item.marginPct.toFixed(1)}%
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div style={{ minWidth: 200 }}>
                        <p><strong>Top 5 lowest margin SKUs</strong></p>
                        {insights.topLowMarginSkus.length === 0 ? (
                          <p style={{ color: "var(--p-color-text-subdued)" }}>None</p>
                        ) : (
                          <ul style={{ paddingLeft: 16, margin: 0 }}>
                            {insights.topLowMarginSkus.map((item) => (
                              <li key={`lowmargin-${item.sku}`}>
                                {item.sku} · {formatCurrency(item.netProfit, shopCurrency)} ·{" "}
                                {item.marginPct.toFixed(1)}%
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </Card.Section>
                </PolarisCard>
              )}

              {!ok && (
                <div style={{ marginTop: 16 }}>
                  <PolarisBanner tone="critical" title="Error" onDismiss={() => {}}>
                    {error?.message ?? "Failed to load data."}
                    {error?.hint ? ` ${error.hint}` : ""}
                  </PolarisBanner>
                </div>
              )}

              {ok && emptyStateWebhook && (
                <PolarisCard>
                  <Card.Section>
                    <p>No synced order data yet. Create an order or update a product to start syncing.</p>
                  </Card.Section>
                </PolarisCard>
              )}

              {ok && zeroOrders && !emptyStateWebhook && (
                <PolarisCard>
                  <Card.Section>
                    <p>No orders found in this store (last 30 days).</p>
                  </Card.Section>
                </PolarisCard>
              )}

              {hasRows && (
                <PolarisCard padding="0">
                  <PolarisIndexTable
                    resourceName={{ singular: "SKU", plural: "SKUs" }}
                    itemCount={sortedRows.length}
                    headings={[
                      { title: "SKU" },
                      { title: "Title" },
                      { title: "Qty", alignment: "end" },
                      { title: "Orders", alignment: "end" },
                      {
                        title: "Revenue",
                        alignment: "end",
                        sortable: true,
                        onSort: () => toggleSort("revenue"),
                      },
                      { title: "COGS/unit", alignment: "end" },
                      { title: "Fees", alignment: "end" },
                      {
                        title: "Net Profit",
                        alignment: "end",
                        sortable: true,
                        onSort: () => toggleSort("netProfit"),
                      },
                      {
                        title: "Margin %",
                        alignment: "end",
                        sortable: true,
                        onSort: () => toggleSort("marginPct"),
                      },
                      {
                        title: "Status",
                        alignment: "end",
                      },
                    ]}
                    selectable={false}
                    loading={false}
                  >
                    {sortedRows.map((row) => (
                      <IndexTable.Row
                        key={row.id}
                        id={row.id}
                        tone={row._netProfit < 0 ? "critical" : row._marginPct < WARN_MARGIN_PCT ? "warning" : undefined}
                      >
                        <IndexTable.Cell>{row.sku}</IndexTable.Cell>
                        <IndexTable.Cell>{row.title}</IndexTable.Cell>
                        <IndexTable.Cell>{row.quantity}</IndexTable.Cell>
                        <IndexTable.Cell>{row.orderCount}</IndexTable.Cell>
                        <IndexTable.Cell>{row.revenueFormatted}</IndexTable.Cell>
                        <IndexTable.Cell>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <PolarisTextField
                              type="number"
                              min={0}
                              step={0.01}
                              value={cogsBySku[row.sku] === 0 ? "0" : (cogsBySku[row.sku] ?? "")}
                              onChange={(v) => updateCogs(row.sku, v)}
                              onBlur={() => handleSaveCogs(row, cogsBySku[row.sku] ?? 0)}
                              disabled={row.isSaving}
                              autoComplete="off"
                              label=""
                              labelHidden
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveCogs(row, cogsBySku[row.sku] ?? 0)}
                              disabled={row.isSaving}
                              style={{ fontSize: 12, padding: "4px 8px" }}
                            >
                              {row.isSaving ? "Saving…" : "Save"}
                            </button>
                            {row.savedAt && <PolarisBadge tone="success">Saved</PolarisBadge>}
                            {row.rowError && (
                              <span style={{ color: "var(--p-color-text-critical)", fontSize: 12 }}>{row.rowError}</span>
                            )}
                          </div>
                        </IndexTable.Cell>
                        <IndexTable.Cell>{row.feesFormatted}</IndexTable.Cell>
                        <IndexTable.Cell>
                          <span style={{ marginRight: 8 }}>{row.netProfitFormatted}</span>
                          {row._netProfit < 0 && <PolarisBadge tone="critical">Loss</PolarisBadge>}
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <span style={{ marginRight: 8 }}>{row.marginPercentFormatted}</span>
                          {row._marginPct >= 0 && row._marginPct < WARN_MARGIN_PCT && (
                            <PolarisBadge tone="warning">Low margin</PolarisBadge>
                          )}
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", flexWrap: "wrap" }}>
                            {row.isLossMaking && <PolarisBadge tone="critical">LOSS</PolarisBadge>}
                            {row.isLowMargin && <PolarisBadge tone="warning">LOW MARGIN</PolarisBadge>}
                            {row.isHighFees && <PolarisBadge tone="attention">HIGH FEES</PolarisBadge>}
                          </div>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </PolarisIndexTable>
                </PolarisCard>
              )}
            </>
          )}

          {toastError && (
            <PolarisToast
              content={toastError}
              onDismiss={() => setToastError(null)}
              error
            />
          )}
        </PolarisPage>
      </s-section>
      </s-page>
    </ErrorBoundary>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
