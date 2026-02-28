# .env setup (quick)

Create a **`.env`** file at the **repo root** (same folder as `package.json`).

Add these two lines for Orders token fallback in local dev:

```env
SHOPIFY_SHOP_DOMAIN=eore-dev-test.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_...
```

Replace `shpat_...` with the Admin API access token from your Custom App (see [docs/DEV_CUSTOM_APP_TOKEN.md](DEV_CUSTOM_APP_TOKEN.md)).

- **Restart the dev server** after saving `.env` so the new variables are loaded.
- Running `npm run dev` auto-applies migrations (db:migrate).
- **Never commit `.env`** — it is listed in `.gitignore`.
