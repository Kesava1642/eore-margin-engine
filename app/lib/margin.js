/**
 * Pure margin calculation for a single row (SKU/variant).
 * Single source of truth for cogsTotal, fees, netProfit, marginPct.
 * Handles revenue=0 and invalid inputs safely.
 *
 * @param {number} revenue - Line revenue
 * @param {number} quantity - Units sold
 * @param {number} cogsPerUnit - Cost per unit
 * @param {number} totalFeePct - Combined fee percentage (e.g. shopify + gateway + shipping)
 * @returns {{ cogsTotal: number, fees: number, netProfit: number, marginPct: number }}
 */
export function computeRowMargin(revenue, quantity, cogsPerUnit, totalFeePct) {
  const rev = Number(revenue);
  const qty = Number(quantity);
  const cogsUnit = Number(cogsPerUnit);
  const feePct = Number(totalFeePct);

  const safeRev = Number.isFinite(rev) ? Math.max(0, rev) : 0;
  const safeQty = Number.isFinite(qty) ? Math.max(0, qty) : 0;
  const safeCogsUnit = Number.isFinite(cogsUnit) ? Math.max(0, cogsUnit) : 0;
  const safeFeePct = Number.isFinite(feePct) ? Math.max(0, feePct) : 0;

  const cogsTotal = safeQty * safeCogsUnit;
  const fees = safeRev * (safeFeePct / 100);
  const netProfit = safeRev - fees - cogsTotal;
  const marginPct = safeRev > 0 ? (netProfit / safeRev) * 100 : 0;

  return {
    cogsTotal,
    fees,
    netProfit,
    marginPct,
  };
}
