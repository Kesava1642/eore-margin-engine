import { authenticate } from "../shopify.server";
import { getCogsMap, upsertCogs } from "../services/shop-data.server";

const COGS_MAX = 999999.99;

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
    const url = new URL(request.url);
    const variantIdsParam = url.searchParams.get("variantIds");
    const variantIds = variantIdsParam
      ? variantIdsParam.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    const map = await getCogsMap(shopId, variantIds);
    const cogs = Object.fromEntries(map);
    return jsonResponse({ cogs });
  } catch (e) {
    return jsonResponse(
      { error: e?.message ?? "Internal server error" },
      500,
    );
  }
}

export async function action({ request }) {
  let session;
  try {
    const { session: s } = await authenticate.admin(request);
    session = s;
  } catch {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const shopId = session?.shop?.trim();
  if (!shopId) return jsonResponse({ error: "Unauthorized" }, 401);

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const variantId = body?.variantId != null ? String(body.variantId).trim() : "";
  if (!variantId) {
    return jsonResponse({ error: "variantId is required" }, 400);
  }

  const cogsPerUnitRaw = body?.cogsPerUnit;
  const cogsPerUnit = cogsPerUnitRaw != null && cogsPerUnitRaw !== "" ? Number(cogsPerUnitRaw) : 0;
  if (!Number.isFinite(cogsPerUnit) || cogsPerUnit < 0) {
    return jsonResponse({ error: "cogsPerUnit must be a non-negative number" }, 400);
  }
  if (cogsPerUnit > COGS_MAX) {
    return jsonResponse({ error: `cogsPerUnit must not exceed ${COGS_MAX}` }, 400);
  }

  const sku = body?.sku != null ? String(body.sku).trim() || undefined : undefined;

  try {
    const saved = await upsertCogs(shopId, variantId, sku ?? null, cogsPerUnit);
    return jsonResponse(saved, 200);
  } catch (e) {
    if (e?.message?.includes("non-negative")) {
      return jsonResponse({ error: e.message }, 400);
    }
    return jsonResponse(
      { error: e?.message ?? "Failed to save COGS" },
      500,
    );
  }
}
