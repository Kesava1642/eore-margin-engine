# Custom App Admin Token (local dev fallback)

Use this when the embedded app gets **"This app is not approved to access the Order object"** and you need real Orders data for the margin engine in development.

- **In dev store admin:** Settings → Apps and sales channels → **Develop apps** → **Create app** (or use an existing custom app).
- **Configure Admin API scopes:** Include `read_orders`, `read_products` (and any others your app already uses).
- **Install the app** on your dev store and **copy the "Admin API access token"**.
- **Add to local `.env`:**
  - `SHOPIFY_SHOP_DOMAIN="your-store.myshopify.com"`
  - `SHOPIFY_ADMIN_ACCESS_TOKEN="shpat_xxx_your_copied_token"`
- **Restart the dev server.**

This token is **server-only**. Never commit `.env`.
