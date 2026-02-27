export function computeOrderMargins({ orders, settings, feeConfigOverride }) {
  const feePct = feeConfigOverride?.feePct ?? settings.feePct ?? 0;
  const feeFixed = feeConfigOverride?.feeFixed ?? settings.feeFixed ?? 0;

  const enrichedOrders = orders.map((order) => {
    const revenue = Number(order.revenue || 0);
    const cogs = order.lineItems.reduce(
      (total, item) =>
        total + Number(item.unitCost || 0) * Number(item.quantity || 0),
      0,
    );

    const shipping = Number(order.shipping || 0);
    const lineRevenueTotal = order.lineItems.reduce(
      (total, item) => total + Number(item.revenue || 0),
      0,
    );

    const orderFees = revenue * feePct + feeFixed;

    const lineItems = order.lineItems.map((item) => {
      const lineRevenue = Number(item.revenue || 0);
      const share = lineRevenueTotal > 0 ? lineRevenue / lineRevenueTotal : 0;
      const shippingAllocated = shipping * share;
      const feesAllocated = orderFees * share;
      const lineCogs =
        Number(item.unitCost || 0) * Number(item.quantity || 0) || 0;
      const grossMargin = lineRevenue - lineCogs;
      const netMargin = grossMargin - shippingAllocated - feesAllocated;

      return {
        ...item,
        shippingAllocated,
        feesAllocated,
        cogs: lineCogs,
        grossMargin,
        netMargin,
      };
    });

    const grossMargin = revenue - cogs;
    const netMargin = grossMargin - shipping - orderFees;

    return {
      ...order,
      cogs,
      grossMargin,
      netMargin,
      shipping,
      fees: orderFees,
      lineItems,
    };
  });

  return enrichedOrders;
}

export function aggregateVariantMargins(orders) {
  const byVariant = new Map();

  for (const order of orders) {
    for (const item of order.lineItems) {
      const key = item.variantId || item.sku || item.id;
      if (!key) continue;

      const existing = byVariant.get(key) ?? {
        variantId: item.variantId,
        sku: item.sku,
        title: item.title,
        units: 0,
        revenue: 0,
        cogs: 0,
        grossMargin: 0,
        netMargin: 0,
      };

      existing.units += Number(item.quantity || 0);
      existing.revenue += Number(item.revenue || 0);
      existing.cogs += Number(item.cogs || 0);
      existing.grossMargin += Number(item.grossMargin || 0);
      existing.netMargin += Number(item.netMargin || 0);

      byVariant.set(key, existing);
    }
  }

  return Array.from(byVariant.values()).map((row) => {
    const grossMarginPct =
      row.revenue > 0 ? row.grossMargin / row.revenue : undefined;
    const netMarginPct =
      row.revenue > 0 ? row.netMargin / row.revenue : undefined;

    return {
      ...row,
      grossMarginPct,
      netMarginPct,
    };
  });
}

