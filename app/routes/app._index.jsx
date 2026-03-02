import { useCallback, useMemo, useState, useRef, useEffect } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

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

  const variantSku = line.variant?.sku?.trim();
  if (variantSku) {
    return { key: `sku:${variantSku}`, displaySku: variantSku };
  }

  const variantId = line.variant?.id;
  if (variantId) {
    return { key: `variant:${variantId}`, displaySku: `VAR-${last6(variantId)}` };
  }

  const productId = line.product?.id;
  if (productId) {
    return {
      key: `product:${productId}:${normTitle}`,
      displaySku: `PROD-${last6(productId)}`,
    };
  }

  const lineItemId = line.id;
  if (lineItemId) {
    return { key: `line:${lineItemId}`, displaySku: `LINE-${last6(lineItemId)}` };
  }

  return {
    key: `fallback:${orderId}:${normTitle}:${index}`,
    displaySku: `UNK-${index + 1}`,
  };
}

function isPcdBlockedError(message) {
  if (typeof message !== "string") return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("not approved to access the order object") ||
    lower.includes("protected customer data")
  );
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
      const { key, displaySku } = getStableKeyAndSku(line, order.id, lineIndex);
      lineIndex += 1;
      const title = line.title || "Untitled";
      const qty = Math.max(0, Number(line.quantity) || 0);
      const amountStr = line.originalTotalSet?.shopMoney?.amount ?? "0";
      const revenue = Number(amountStr) || 0;

      if (!firstLineItem) {
        firstLineItem = { sku: displaySku, title, qty, revenue };
      }

      const existing = agg.get(key);
      if (existing) {
        existing.quantity += qty;
        existing.revenue += revenue;
        existing.orderIds.add(order.id);
      } else {
        agg.set(key, {
          sku: displaySku,
          title,
          quantity: qty,
          revenue,
          orderIds: new Set([order.id]),
        });
      }
    }
  }

  const rows = Array.from(agg.values()).map((r) => ({
    sku: r.sku,
    title: r.title,
    quantity: r.quantity,
    orderCount: r.orderIds.size,
    revenue: Math.round(r.revenue * 100) / 100,
  }));

  return {
    rows,
    lineItemsParsed,
    firstOrderId,
    firstLineItem,
    ordersCount: ordersEdges.length,
  };
}

const ADMIN_API_VERSION = "2025-01";

async function fetchOrdersWithCustomToken(shopDomain, accessToken, query) {
  const url = `https://${shopDomain.replace(/^https?:\/\//, "").split("/")[0]}/admin/api/${ADMIN_API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      query: ORDERS_QUERY,
      variables: { query },
    }),
  });
  const status = res.status;
  let data = null;
  let errors = null;
  let graphqlError = null;
  try {
    const json = await res.json();
    data = json.data ?? null;
    errors = json.errors ?? null;
    if (errors?.length) {
      const first = errors[0];
      graphqlError = typeof first?.message === "string" ? first.message : "Unknown GraphQL error";
    }
  } catch {
    graphqlError = "Failed to parse response JSON";
  }
  return { data, errors, status, graphqlError };
}

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

async function getSavedCogsBySku(shop) {
  if (!shop || typeof shop !== "string") return {};
  try {
    const rows = await prisma.skuCost.findMany({
      where: { shop: shop.trim() },
    });
    return Object.fromEntries(
      rows.map((r) => [r.sku, Number(r.cogsUnit)]).filter(([, n]) => Number.isFinite(n)),
    );
  } catch {
    return {};
  }
}

async function getDebugDb(shop) {
  const dbUrl = process.env.DATABASE_URL || "(sqlite default)";
  let skuCostRowCount = null;
  if (shop && typeof shop === "string") {
    try {
      skuCostRowCount = await prisma.skuCost.count({ where: { shop: shop.trim() } });
    } catch {
      skuCostRowCount = null;
    }
  }
  return { dbUrl, skuCostRowCount };
}

export const action = async ({ request }) => {
  if (request.method !== "POST") return { ok: false, error: "Method not allowed" };
  try {
    const { session } = await authenticate.admin(request);
    const shop = session?.shop?.trim();
    if (!shop) return { ok: false, error: "Missing shop" };
    const formData = await request.formData();
    const intent = formData.get("intent");
    if (intent !== "save_cogs") return { ok: false, error: "Invalid intent" };
    const sku = formData.get("sku");
    if (typeof sku !== "string" || !sku.trim()) return { ok: false, error: "sku is required" };
    const skuTrim = sku.trim();
    const title = formData.get("title");
    const titleVal = typeof title === "string" ? title.trim() || null : null;
    const cogsUnitRaw = formData.get("cogsUnit");
    const cogsUnitNum = cogsUnitRaw !== null && cogsUnitRaw !== "" ? Number(cogsUnitRaw) : 0;
    if (!Number.isFinite(cogsUnitNum) || cogsUnitNum < 0)
      return { ok: false, error: "cogsUnit must be a non-negative number" };
    await prisma.skuCost.upsert({
      where: { shop_sku: { shop, sku: skuTrim } },
      update: { cogsUnit: cogsUnitNum, title: titleVal },
      create: {
        shop,
        sku: skuTrim,
        title: titleVal,
        cogsUnit: cogsUnitNum,
      },
    });
    return { ok: true, sku: skuTrim, cogsUnit: cogsUnitNum, savedAt: new Date().toISOString() };
  } catch (e) {
    return { ok: false, error: e?.message ?? "Failed to save COGS" };
  }
};

export const loader = async ({ request }) => {
  const query = `created_at:>=${formatDateDaysAgo(30)}`;
  const hasShopDomain = Boolean(
    process.env.SHOPIFY_SHOP_DOMAIN && String(process.env.SHOPIFY_SHOP_DOMAIN).trim(),
  );
  const hasAdminToken = Boolean(
    process.env.SHOPIFY_ADMIN_ACCESS_TOKEN && String(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN).trim(),
  );

  const missingEnvHint = `Missing env: SHOPIFY_SHOP_DOMAIN=${hasShopDomain ? "present" : "missing"}, SHOPIFY_ADMIN_ACCESS_TOKEN=${hasAdminToken ? "present" : "missing"}. Add them to .env (see docs/DEV_CUSTOM_APP_TOKEN.md) and restart dev.`;
  const tokenFailedHint =
    "Token fallback failed. Check token, scopes, and shop domain (see docs/DEV_CUSTOM_APP_TOKEN.md).";
  const pcdDocLine =
    "See docs/SHOPIFY_ORDERS_ACCESS.md for the single correct path (Production approval vs Dev token).";

  let sessionShop = null;

  try {
    const { admin, session } = await authenticate.admin(request);
    sessionShop = session?.shop ?? null;
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
            return {
              ok: false,
              shop: shopDomain,
              error: {
                message: result.errors.map((e) => e.message).join(", "),
                hint: `${tokenFailedHint} ${pcdDocLine}`,
              },
              counts: { ordersFetched: 0, lineItemsParsed: 0, skuRows: 0 },
              preview: {},
              rows: [],
              savedCogsBySku: {},
              debug: { ...makeDebug({
                authMode: "blocked",
                hasShopDomain,
                hasAdminToken,
                tokenAttempted,
                tokenHttpStatus,
                tokenGraphqlError,
              }), db: debugDb },
            };
          }
          const ordersEdges = result.data?.orders?.edges ?? [];
          const agg = aggregateOrdersToRows(ordersEdges);
          const savedCogsBySku = await getSavedCogsBySku(shopDomain);
          const debugDb = await getDebugDb(shopDomain);
          return {
            ok: true,
            shop: shopDomain,
            authMode: "token-fallback",
            counts: {
              ordersFetched: agg.ordersCount,
              lineItemsParsed: agg.lineItemsParsed,
              skuRows: agg.rows.length,
            },
            preview: {
              firstOrderId: agg.firstOrderId,
              firstLineItem: agg.firstLineItem,
            },
            rows: agg.rows,
            savedCogsBySku,
            debug: { ...makeDebug({
              authMode: "token-fallback",
              hasShopDomain,
              hasAdminToken,
              tokenAttempted,
              tokenHttpStatus,
              tokenGraphqlError: null,
            }), db: debugDb },
          };
        }
        const debugDb = await getDebugDb(sessionShop);
        return {
          ok: false,
          shop: sessionShop,
          error: { message, hint: `${missingEnvHint} ${pcdDocLine}` },
          counts: { ordersFetched: 0, lineItemsParsed: 0, skuRows: 0 },
          preview: {},
          rows: [],
          savedCogsBySku: {},
          debug: { ...makeDebug({
            authMode: "blocked",
            hasShopDomain,
            hasAdminToken,
            tokenAttempted: false,
            tokenHttpStatus: null,
            tokenGraphqlError: null,
          }), db: debugDb },
        };
      }
      const debugDb = await getDebugDb(sessionShop);
      return {
        ok: false,
        shop: sessionShop,
        error: {
          message,
          hint: "Check Admin API permissions and query.",
        },
        counts: { ordersFetched: 0, lineItemsParsed: 0, skuRows: 0 },
        preview: {},
        rows: [],
        savedCogsBySku: {},
        debug: { ...makeDebug({ authMode: "session", hasShopDomain, hasAdminToken }), db: debugDb },
      };
    }

    const ordersEdges = json.data?.orders?.edges ?? [];
    const agg = aggregateOrdersToRows(ordersEdges);
    const savedCogsBySku = await getSavedCogsBySku(sessionShop);
    const debugDb = await getDebugDb(sessionShop);
    return {
      ok: true,
      shop: sessionShop,
      authMode: "session",
      counts: {
        ordersFetched: agg.ordersCount,
        lineItemsParsed: agg.lineItemsParsed,
        skuRows: agg.rows.length,
      },
      preview: {
        firstOrderId: agg.firstOrderId,
        firstLineItem: agg.firstLineItem,
      },
      rows: agg.rows,
      savedCogsBySku,
      debug: { ...makeDebug({ authMode: "session", hasShopDomain, hasAdminToken }), db: debugDb },
    };
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
            const savedCogsBySku = await getSavedCogsBySku(shopDomain);
            const debugDb = await getDebugDb(shopDomain);
            return {
              ok: true,
              shop: shopDomain,
              authMode: "token-fallback",
              counts: {
                ordersFetched: agg.ordersCount,
                lineItemsParsed: agg.lineItemsParsed,
                skuRows: agg.rows.length,
              },
              preview: {
                firstOrderId: agg.firstOrderId,
                firstLineItem: agg.firstLineItem,
              },
              rows: agg.rows,
              savedCogsBySku,
              debug: { ...makeDebug({
                authMode: "token-fallback",
                hasShopDomain,
                hasAdminToken,
                tokenAttempted,
                tokenHttpStatus,
                tokenGraphqlError: null,
              }), db: debugDb },
            };
          }
        } catch {
          tokenAttempted = true;
          // tokenHttpStatus / tokenGraphqlError may be unset if fetch threw before response
        }
        const debugDbCatch1 = await getDebugDb(sessionShop ?? null);
        return {
          ok: false,
          shop: sessionShop ?? null,
          error: { message, hint: `${tokenFailedHint} ${pcdDocLine}` },
          counts: { ordersFetched: 0, lineItemsParsed: 0, skuRows: 0 },
          preview: {},
          rows: [],
          savedCogsBySku: {},
          debug: { ...makeDebug({
            authMode: "blocked",
            hasShopDomain,
            hasAdminToken,
            tokenAttempted,
            tokenHttpStatus,
            tokenGraphqlError,
          }), db: debugDbCatch1 },
        };
      }
      const debugDbCatch2 = await getDebugDb(sessionShop ?? null);
      return {
        ok: false,
        shop: sessionShop ?? null,
        error: { message, hint: `${missingEnvHint} ${pcdDocLine}` },
        counts: { ordersFetched: 0, lineItemsParsed: 0, skuRows: 0 },
        preview: {},
        rows: [],
        savedCogsBySku: {},
        debug: { ...makeDebug({
          authMode: "blocked",
          hasShopDomain,
          hasAdminToken,
          tokenAttempted: false,
          tokenHttpStatus: null,
          tokenGraphqlError: null,
        }), db: debugDbCatch2 },
      };
    }
    const debugDbCatch3 = await getDebugDb(sessionShop ?? null);
    return {
      ok: false,
      shop: sessionShop ?? null,
      error: {
        message,
        hint: "Admin API may be unavailable or session invalid.",
      },
      counts: { ordersFetched: 0, lineItemsParsed: 0, skuRows: 0 },
      preview: {},
      rows: [],
      savedCogsBySku: {},
      debug: { ...makeDebug({ authMode: "session", hasShopDomain, hasAdminToken }), db: debugDbCatch3 },
    };
  }
};

const WARN_MARGIN_PERCENT = 10;

export default function Index() {
  const loaderData = useLoaderData?.() ?? {};
  const [feePercent, setFeePercent] = useState(3);
  const [cogsBySku, setCogsBySku] = useState(() => loaderData.savedCogsBySku ?? {});
  const [lastUpdated] = useState(() => new Date().toISOString());
  const [savedSkuAt, setSavedSkuAt] = useState({});
  const [errorBySku, setErrorBySku] = useState({});
  const [lastSave, setLastSave] = useState(null);
  const fetcher = useFetcher();
  const lastSubmitSkuRef = useRef(null);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const sku = fetcher.data.ok ? fetcher.data.sku : lastSubmitSkuRef.current;
    if (fetcher.data.ok && sku) {
      setSavedSkuAt((prev) => ({ ...prev, [sku]: Date.now() }));
      setErrorBySku((prev) => ({ ...prev, [sku]: undefined }));
      if (fetcher.data.savedAt) setLastSave({ sku: fetcher.data.sku, savedAt: fetcher.data.savedAt });
      const t = setTimeout(() => setSavedSkuAt((prev) => ({ ...prev, [sku]: undefined })), 3000);
      return () => clearTimeout(t);
    }
    if (!fetcher.data.ok && sku)
      setErrorBySku((prev) => ({ ...prev, [sku]: fetcher.data.error ?? "Save failed" }));
    lastSubmitSkuRef.current = null;
  }, [fetcher.state, fetcher.data]);

  const handleSaveCogs = useCallback((sku, title, cogsUnit) => {
    lastSubmitSkuRef.current = sku;
    fetcher.submit(
      { intent: "save_cogs", sku, title: title ?? "", cogsUnit: String(cogsUnit ?? 0) },
      { method: "POST" },
    );
  }, [fetcher]);

  const updateCogs = useCallback((sku, value) => {
    const num = value === "" ? 0 : Number(value);
    setCogsBySku((prev) => (Number.isNaN(num) ? prev : { ...prev, [sku]: num }));
  }, []);

  const tableRows = useMemo(() => {
    const rows = loaderData.rows ?? [];
    const feePct = Number(feePercent) || 0;
    return rows.map((r) => {
      const revenue = Number(r.revenue) || 0;
      const qty = Number(r.quantity) || 0;
      const cogs = cogsBySku[r.sku] ?? 0;
      const fees = (revenue * feePct) / 100;
      const cogsTotal = cogs * qty;
      const netProfit = revenue - fees - cogsTotal;
      const marginPercent = revenue > 0 ? (netProfit / revenue) * 100 : 0;
      const isSaving = fetcher.state !== "idle" && lastSubmitSkuRef.current === r.sku;
      const savedAt = savedSkuAt[r.sku];
      const rowError = errorBySku[r.sku];
      return {
        ...r,
        id: r.sku,
        revenue: revenue.toFixed(2),
        cogsInput: (
          <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <input
              type="number"
              min={0}
              step={0.01}
              value={cogsBySku[r.sku] ?? ""}
              onChange={(e) => updateCogs(r.sku, e.target.value)}
              style={{ width: 72 }}
              aria-label={`COGS for ${r.sku}`}
            />
            <button
              type="button"
              onClick={() => handleSaveCogs(r.sku, r.title, cogsBySku[r.sku] ?? 0)}
              disabled={isSaving}
              style={{ fontSize: 12, padding: "2px 8px" }}
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
            {savedAt && (
              <span style={{ color: "var(--p-color-text-success, #008060)", fontSize: 12 }}>Saved</span>
            )}
            {rowError && (
              <span style={{ color: "var(--p-color-text-critical, #d72c0d)", fontSize: 12 }}>{rowError}</span>
            )}
          </span>
        ),
        fees: fees.toFixed(2),
        netProfit: netProfit.toFixed(2),
        marginPercent: marginPercent.toFixed(1) + "%",
        _marginPercent: marginPercent,
      };
    });
  }, [
    loaderData.rows,
    feePercent,
    cogsBySku,
    updateCogs,
    fetcher.state,
    savedSkuAt,
    errorBySku,
    handleSaveCogs,
  ]);

  const columns = [
    { id: "sku", header: "SKU", align: "left" },
    { id: "title", header: "Title", align: "left" },
    { id: "quantity", header: "Qty", align: "right" },
    { id: "orderCount", header: "Orders", align: "right" },
    { id: "revenue", header: "Revenue", align: "right" },
    { id: "cogsInput", header: "COGS/unit", align: "right" },
    { id: "fees", header: "Fees", align: "right" },
    { id: "netProfit", header: "Net Profit", align: "right" },
    { id: "marginPercent", header: "Margin %", align: "right" },
  ];

  const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV === true;
  const { ok, shop, error, authMode, counts = {}, preview = {}, rows: rawRows = [], debug = {} } = loaderData;
  const debugDb = debug?.db ?? {};
  const dbUrl = debugDb.dbUrl ?? "—";
  const skuCostRowCount = debugDb.skuCostRowCount != null ? String(debugDb.skuCostRowCount) : "—";
  const hasRows = ok && rawRows.length > 0;
  const zeroOrders = ok && (counts.ordersFetched ?? 0) === 0;

  return (
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

      <s-section heading="Margin table">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base" blockAlignment="center">
            <label>
              <s-text>Fee %</s-text>
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={feePercent}
                onChange={(e) => setFeePercent(Number(e.target.value) || 0)}
                style={{ marginLeft: 8, width: 64 }}
                aria-label="Global fee percentage"
              />
            </label>
          </s-stack>

          {!ok && (
            <s-banner tone="critical" title="Error">
              {error?.message ?? "Failed to load data."}
              {error?.hint ? ` ${error.hint}` : ""}
            </s-banner>
          )}

          {zeroOrders && (
            <s-paragraph>No orders found in this store (last 30 days).</s-paragraph>
          )}

          {hasRows && (
            <s-box borderWidth="base" borderRadius="large" background="surface">
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {columns.map((col) => (
                      <th
                        key={col.id}
                        style={{
                          textAlign: col.align ?? "left",
                          padding: "8px 12px",
                          fontWeight: 500,
                        }}
                        scope="col"
                      >
                        {col.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row) => (
                    <tr
                      key={row.id}
                      className={
                        row._marginPercent < 0
                          ? "margin-negative"
                          : row._marginPercent < WARN_MARGIN_PERCENT
                            ? "margin-warning"
                            : ""
                      }
                      style={{
                        backgroundColor:
                          row._marginPercent < 0
                            ? "rgba(214, 44, 13, 0.08)"
                            : row._marginPercent < WARN_MARGIN_PERCENT
                              ? "rgba(185, 137, 0, 0.08)"
                              : undefined,
                        borderTop: "1px solid var(--p-color-border-subdued, #e1e3e5)",
                      }}
                    >
                      {columns.map((col) => (
                        <td
                          key={col.id}
                          style={{
                            textAlign: col.align ?? "left",
                            padding: "8px 12px",
                          }}
                        >
                          {row[col.id]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </s-box>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
