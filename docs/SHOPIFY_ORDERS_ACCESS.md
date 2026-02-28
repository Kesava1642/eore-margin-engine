# Shopify Orders access (Protected Customer Data)

This app needs **Orders** (and line items) for SKU revenue and margin calculations. Shopify protects the Order object under **Protected Customer Data (PCD)** rules. This doc describes why access is blocked and the single correct path for production vs development.

---

## A) Why Orders are blocked

The **Order** object is protected under [Shopify Protected Customer Data](https://shopify.dev/docs/apps/build/privacy-law-compliance/protected-customer-data) rules. Apps that read order data (including line items, revenue, and identifiers) must meet Shopify’s requirements for access.

Requesting scopes such as `read_orders` in your app config is **not enough by itself**. Shopify may still return:

- **"This app is not approved to access the Order object"**

until either:

- Your **public app** has been granted Protected Customer Data access (production), or  
- You use a **Custom App** Admin API token in development (dev store only).

---

## B) Single correct path for Production (Public app)

For a **public or listed app** that needs Orders in production:

1. **Request Protected Customer Data access** in the [Shopify Partner Dashboard](https://partners.shopify.com):
   - Open your app → **App setup** / **Configuration**.
   - Find the **Protected Customer Data** or **Order data access** request flow.
   - Submit a request describing:
     - **Minimum data required:** e.g. order id, line items (SKU, title, quantity, line total) for margin/revenue only — no customer PII, payment details, or addresses unless strictly necessary.
     - **Use case:** e.g. “SKU-level revenue and margin reporting for the merchant.”
     - **Compliance / privacy:** how you store, process, and retain the data (e.g. aggregated only, no export of PII).

2. **What Shopify evaluates:**
   - Whether you truly need the requested fields.
   - Your privacy policy and data handling.
   - Compliance readiness (e.g. GDPR, CCPA) if you handle personal data.

3. **What to expect:**
   - Approval is required; it can take some time.
   - Until approved, Orders access may be blocked or fields redacted.
   - After approval, use the **session** (embedded app) auth; the Orders query will succeed and the debug panel will show **Auth mode: session**.

---

## C) Single correct path for Development (Dev store)

For **local development** on a **dev store**, you can avoid waiting for PCD approval by using a **Custom App** Admin API token:

1. In the **dev store admin:** Settings → Apps and sales channels → **Develop apps** → Create app (or use an existing custom app).
2. **Configure Admin API scopes** to include at least:
   - `read_orders`
   - `read_products`
   (plus any other scopes your app already uses.)
3. **Install the app** on the dev store and copy the **Admin API access token** (`shpat_...`).
4. Add to your local **`.env`**:
   - `SHOPIFY_SHOP_DOMAIN="your-dev-store.myshopify.com"`
   - `SHOPIFY_ADMIN_ACCESS_TOKEN="shpat_xxx_your_copied_token"`
5. **Restart the dev server.**

Full step-by-step: **[docs/DEV_CUSTOM_APP_TOKEN.md](DEV_CUSTOM_APP_TOKEN.md)**.

The app will use this token as a fallback when the session-based Orders query is blocked; the debug panel will show **Auth mode: token-fallback**. The token is server-only and must never be committed.

---

## D) Verification checklist

- [ ] **Orders query returns data:** Debug panel shows `ordersFetched > 0` when the store has orders.
- [ ] **Auth mode:** Debug panel shows **Auth mode: token-fallback** in dev (with Custom App token) or **Auth mode: session** in production (after PCD approval).
- [ ] **No PCD error:** The UI does not show “not approved to access the Order object” or “protected customer data” errors.

If any of these fail, use the production path (B) or dev path (C) above and the doc they reference.
