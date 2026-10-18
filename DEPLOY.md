# Floof v4 — Railway Backend Deployment Guide

Deploy `floof-backend` (Medusa 2) to Railway for [floof.space](https://www.floof.space).

---

## 1. Create Railway project

1. [railway.com/dashboard](https://railway.com/dashboard) → **New Project** → **Deploy from GitHub repo**
2. Select `0node0/floof-backend`
3. Railway uses the root `Dockerfile` and `railway.toml`

---

## 2. Environment variables

In Railway → **Variables**:

| Variable | Value / notes |
|----------|----------------|
| `NODE_ENV` | `production` |
| `PORT` | `9000` (Railway may override) |
| `DATABASE_URL` | From Railway Postgres (see below) |
| `REDIS_URL` | From Railway Redis |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `COOKIE_SECRET` | `openssl rand -hex 32` (different from JWT) |
| `MEDUSA_BACKEND_URL` | Public API URL, e.g. `https://api.floof.space` |
| `STORE_CORS` | `https://floof.space,https://www.floof.space` |
| `ADMIN_CORS` | `https://floof.space,https://www.floof.space` |
| `AUTH_CORS` | Same as storefront/admin origins you use |
| `STRIPE_SECRET_KEY` | Stripe Dashboard → API keys (`sk_live_…` or `sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for `https://api.floof.space/webhooks/stripe` |
| `STRIPE_AUTOMATIC_TAX` | `false` until Stripe Tax is enabled; then `true` |
| `PRINTFUL_API_TOKEN` | Printful private API token |
| `PRINTFUL_STORE_ID` | Optional, for multi-store / OAuth tokens |
| `PRINTFUL_WEBHOOK_PATH` | Random hex path segment (`openssl rand -hex 32`) — **required in production** |
| `PRINTFUL_AUTO_CONFIRM` | `true` (default) auto-confirms Printful orders; `false` leaves drafts |
| `FLOOF_ADMIN_KEY` | `openssl rand -hex 32` — Studio + design APIs |
| `SHIPPING_FREE_THRESHOLD_USD` | `75` — free shipping at/above this subtotal |
| `SHIPPING_FLAT_RATE_USD` | `6.99` — fallback when Printful rates unavailable |
| `SHIPPING_USE_PRINTFUL_RATES` | `true` — use Printful `/shipping/rates` when cart has US address |

Optional cent overrides: `SHIPPING_FREE_THRESHOLD_CENTS`, `SHIPPING_FLAT_RATE_CENTS`.

**Durable public files (recommended):** configure Cloudflare R2 so design staging and product image rehosting are not tied to the container disk.

| Variable | Value / notes |
|----------|----------------|
| `R2_ACCOUNT_ID` | Cloudflare account id |
| `R2_ACCESS_KEY_ID` | R2 API token |
| `R2_SECRET_ACCESS_KEY` | R2 API secret |
| `R2_BUCKET` | e.g. `floof-designs` |
| `R2_PUBLIC_BASE_URL` | Public bucket URL, e.g. `https://designs.floof.space` |

**Ephemeral disk:** Railway’s default container filesystem is **not** durable across redeploys (no volume is configured in `railway.toml`). Do not store product images under `api.floof.space/static/…` on disk — use R2 or Printful CDN. To fix existing products:

```bash
curl -X POST https://api.floof.space/floof/design-products \
  -H "x-floof-admin-key: $FLOOF_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"maintenance":"migrateEphemeralProductImages","dryRun":true,"handlePrefix":"flower-crown-"}'
```

Then run again with `"dryRun":false`.

---

## 3. Database services

1. **New** → **Database** → **PostgreSQL** (Railway sets `DATABASE_URL`)
2. **New** → **Redis** (Railway sets `REDIS_URL`)

---

## 4. Custom domain (Railway + Cloudflare)

1. Railway → service → **Settings** → **Networking** → **Custom Domain** → `api.floof.space`
2. Copy the Railway hostname (CNAME target)
3. **Cloudflare** DNS for `floof.space`:
   - Type: **CNAME**
   - Name: `api`
   - Target: Railway CNAME (e.g. `….up.railway.app`)
   - Proxy: DNS only (grey cloud) is typical for Railway; follow Railway’s doc for your setup

Storefront (`www.floof.space`) is deployed separately (e.g. Cloudflare Pages from `0node0/floof-storefront`).

---

## 5. Migrations and seed

After first deploy:

```bash
npx medusa db:migrate
npx medusa exec ./src/scripts/seed.ts
```

Or use `start.sh` if your image runs migrations on boot.

---

## 6. Publishable API key

After seed, check logs for the publishable key or use Admin API. Set `PUBLIC_MEDUSA_PK` on the storefront.

---

## 7. Webhooks

### Stripe

- URL: `https://api.floof.space/webhooks/stripe`
- Events: `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed` (others are ignored)
- Copy signing secret → `STRIPE_WEBHOOK_SECRET`

### Printful

- URL: `https://api.floof.space/webhooks/printful/<PRINTFUL_WEBHOOK_PATH>`
- Register in Printful Dashboard → Store → Settings → Webhooks
- The path segment must match `PRINTFUL_WEBHOOK_PATH` exactly (no webhooks accepted if unset)

---

## 8. Health

```bash
curl https://api.floof.space/health
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Printful webhook 503 | Set `PRINTFUL_WEBHOOK_PATH` and use full URL with that segment |
| Checkout missing shipping | Ensure `SHIPPING_*` vars set; cart variants need `printful_catalog_variant_id` metadata for Printful rates |
| Stripe tax not applied | Set `STRIPE_AUTOMATIC_TAX=true` only after enabling Stripe Tax |
| Design API CORS from Studio | Add your origin to `STORE_CORS` / `ADMIN_CORS` |
