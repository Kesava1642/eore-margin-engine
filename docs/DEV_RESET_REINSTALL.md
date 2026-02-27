# Dev reset + reinstall

---

## STEP 1 — START DEV WITH RESET

From the project root (`C:\dev\eore-margin-engine`), run:

```bash
shopify app dev --use-localhost --reset
```

---

## STEP 2 — SELECT THESE OPTIONS WHEN PROMPTED

- **Which organization?** → EORE Technologies
- **Create this project as a new app on Shopify?** → No, connect it to an existing app
- **Which existing app is this for?** → EORE Margin Engine (shopify.app.toml)

---

## STEP 3 — INSTALL THE APP

When the CLI shows the install URL:

1. Open the URL in the browser.
2. Approve the requested permissions.
3. Confirm the permissions list includes:
   - write_products
   - write_metaobject_definitions
4. Complete installation.

---

## STEP 4 — VERIFY SUCCESS

Success looks like:

- Dev server keeps running.
- No error like: "Requires the following access scope…"
- Preview/install URLs are shown as usual.

Do not change any source files, database, or routes. This is installation and reset only.
