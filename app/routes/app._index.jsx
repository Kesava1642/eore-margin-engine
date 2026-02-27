import { useCallback, useMemo, useState } from "react";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

const ORDERS_QUERY = `#graphql
  query OrdersWithLineItems($query: String) {
    orders(first: 100, query: $query) {
      edges {
        node {
          id
          name
          lineItems(first: 250) {
            edges {
              node {
                sku
                title
                quantity
                originalTotalSet {
                  shopMoney {
                    amount
                  }
                }
                variant {
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

export const loader = async ({ request }) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    const query = `created_at:>=${formatDateDaysAgo(30)}`;
    const response = await admin.graphql(ORDERS_QUERY, {
      variables: { query },
    });
    const json = await response.json();

    if (json.errors?.length) {
      return {
        ok: false,
        shop: session?.shop ?? null,
        error: {
          message: json.errors.map((e) => e.message).join(", "),
          hint: "Check Admin API permissions and query.",
        },
        counts: { ordersFetched: 0, lineItemsParsed: 0, skuRows: 0 },
        preview: {},
        rows: [],
      };
    }

    const orders = json.data?.orders?.edges ?? [];
    const agg = new Map();
    let lineItemsParsed = 0;
    let firstOrderId = null;
    let firstLineItem = null;

    for (const { node: order } of orders) {
      if (!firstOrderId) firstOrderId = order.id;
      const lineEdges = order.lineItems?.edges ?? [];
      for (const { node: line } of lineEdges) {
        lineItemsParsed += 1;
        const skuRaw = line.sku?.trim() || line.variant?.id || `line-${lineItemsParsed}`;
        const skuKey = String(skuRaw);
        const title = line.title || "Untitled";
        const qty = Math.max(0, Number(line.quantity) || 0);
        const amountStr = line.originalTotalSet?.shopMoney?.amount ?? "0";
        const revenue = Number(amountStr) || 0;

        if (!firstLineItem) {
          firstLineItem = { sku: skuKey, title, qty, revenue };
        }

        const existing = agg.get(skuKey);
        if (existing) {
          existing.quantity += qty;
          existing.revenue += revenue;
          existing.orderIds.add(order.id);
        } else {
          agg.set(skuKey, {
            sku: skuKey,
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
      ok: true,
      shop: session?.shop ?? null,
      counts: {
        ordersFetched: orders.length,
        lineItemsParsed,
        skuRows: rows.length,
      },
      preview: {
        firstOrderId,
        firstLineItem,
      },
      rows,
    };
  } catch (e) {
    return {
      ok: false,
      shop: null,
      error: {
        message: e?.message ?? "Unknown error",
        hint: "Admin API may be unavailable or session invalid.",
      },
      counts: { ordersFetched: 0, lineItemsParsed: 0, skuRows: 0 },
      preview: {},
      rows: [],
    };
  }
};

const WARN_MARGIN_PERCENT = 10;

export default function Index() {
  const loaderData = useLoaderData?.() ?? {};
  const [feePercent, setFeePercent] = useState(3);
  const [cogsBySku, setCogsBySku] = useState({});
  const [lastUpdated] = useState(() => new Date().toISOString());

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
      return {
        ...r,
        id: r.sku,
        revenue: revenue.toFixed(2),
        cogsInput: (
          <input
            type="number"
            min={0}
            step={0.01}
            value={cogsBySku[r.sku] ?? ""}
            onChange={(e) => updateCogs(r.sku, e.target.value)}
            style={{ width: "72px" }}
            aria-label={`COGS for ${r.sku}`}
          />
        ),
        fees: fees.toFixed(2),
        netProfit: netProfit.toFixed(2),
        marginPercent: marginPercent.toFixed(1) + "%",
        _marginPercent: marginPercent,
      };
    });
  }, [loaderData.rows, feePercent, cogsBySku, updateCogs]);

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
  const { ok, shop, error, counts = {}, preview = {}, rows: rawRows = [] } = loaderData;
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
              {error?.message ?? "Failed to load data."} {error?.hint ?? ""}
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
