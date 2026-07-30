# Design → Printful → Floof product pipeline

Upload a PNG design, create a Printful sync product (with product + lifestyle mockups), and publish it on the Floof Medusa storefront.

## Flow

```
PNG (URL or Studio upload)
    → stage public temp URL (if upload)
    → Printful File Library
    → Printful Sync Product (front print on selected blanks)
    → Printful Mockup Generator (flat/product + model/lifestyle)
    → Medusa published product (images + PF-{sync_variant_id} SKUs)
    → live on https://www.floof.space/products/{handle}
```

## Defaults

| Setting | Default |
|--------|---------|
| Tee blank | Bella+Canvas 3001 (catalog **#71**) |
| Hoodie blank | Gildan 18500 (catalog **#146**) |
| Colors | Black, White |
| Sizes | S–2XL |
| Tee price | $28.00 |
| Hoodie price | $48.00 |

Override via API body or env (CLI).

## Auth

Set `FLOOF_ADMIN_KEY` on the backend (Railway). All design endpoints require:

```
x-floof-admin-key: <same secret>
```

Also set `MEDUSA_BACKEND_URL` to the **public** Railway backend URL so Printful can download staged uploads.

## API

### Create product

```http
POST /floof/design-products
x-floof-admin-key: YOUR_KEY
Content-Type: application/json
```

**Public URL:**

```json
{
  "name": "Humidity Club",
  "designUrl": "https://cdn.example.com/humidity.png",
  "garment": "tee",
  "colors": ["Black", "White"],
  "sizes": ["S", "M", "L", "XL", "2XL"],
  "retailPrice": "28.00",
  "generateMockups": true
}
```

**Browser upload (base64):**

```json
{
  "name": "Humidity Club",
  "designBase64": "data:image/png;base64,iVBOR…",
  "garment": "tee"
}
```

**Response (201):**

```json
{
  "ok": true,
  "printful": { "syncProductId": 123, "variantCount": 10 },
  "mockups": [{ "url": "https://…", "kind": "product" }, { "kind": "lifestyle" }],
  "medusa": { "productId": "prod_…", "handle": "floof-humidity-club" },
  "storeUrl": "https://www.floof.space/products/floof-humidity-club",
  "logs": ["…"]
}
```

### Staged design fetch (for Printful only)

```http
GET /floof/design-files/:id
```

TTL ~30 minutes, in-memory (single Railway instance).

## CLI

From `floof-backend` with env loaded:

```bash
DESIGN_URL=https://…/design.png \
PRODUCT_NAME="Humidity Club" \
GARMENT=tee \
yarn create:from-design
```

Optional: `COLORS`, `SIZES`, `RETAIL_PRICE`, `DESCRIPTION`, `SKIP_MOCKUPS=1`.

## Studio UI

Storefront page: **https://www.floof.space/studio**

- Enter the same `FLOOF_ADMIN_KEY` (stored in sessionStorage for the tab)
- Upload PNG, set name / garment / colors / sizes
- Creates Printful product + mockups + Medusa listing

## Railway env checklist

```
PRINTFUL_API_TOKEN=…
PRINTFUL_STORE_ID=…          # if using multi-store / OAuth token
FLOOF_ADMIN_KEY=…            # openssl rand -hex 32
MEDUSA_BACKEND_URL=https://floof-backend-production-….up.railway.app
```

Token scopes needed: `sync_products`, `file_library`, and mockup generator access (default private token usually has these).

## Notes

- Body limit for Studio uploads is **20mb** JSON (`bodyParser.sizeLimit` on `/floof/design-products`). If you still see `request entity too large`, compress the PNG or host it and use `designUrl` instead.
- Printful **cannot** read local disk paths — URL or Studio upload only.
- Mockup generation is async and can take 30–90s; the API waits and polls.
- If mockups fail, the product still creates using the design file / thumbnail.
- Orders still use `PF-{sync_variant_id}` SKUs (same as `yarn sync:printful`).
- Re-run is not idempotent by design name; handles get a suffix if taken.
