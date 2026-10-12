# Design → Printful → Floof product pipeline

Upload a PNG design, create a Printful sync product (with product + lifestyle mockups), and publish it on the Floof Medusa storefront.

## Flow

```
PNG (URL or Studio upload)
    → stage public temp URL (if upload)
    → Printful File Library
    → Printful Sync Product (front print on selected blanks)
    → Printful Mockup Generator (flat/product + model/lifestyle)
    → Medusa product (images + PF-{sync_variant_id} SKUs)
    → optional style collection (handle e.g. `retro`)
    → live on https://www.floof.space/products/{handle} (or draft until published)
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
  "generateMockups": true,
  "style": "retro",
  "draft": false
}
```

- **`style`** (optional): Medusa product collection handle (`retro`, `minimal`, …). Collection is created if missing; product is linked after create.
- **`draft`**: When `true`, Medusa product `status` is `draft` (not on storefront until published in Admin).

### Style collection landing metadata

```http
POST /floof/style-collections
x-floof-admin-key: YOUR_KEY
Content-Type: application/json
```

```json
{
  "handle": "retro",
  "title": "Retro",
  "tagline": "Vintage vibes",
  "description": "Curated retro tees",
  "heroCopy": "Throwback graphics for modern closets",
  "accentColors": ["#E8A87C", "#1A1A2E"],
  "seoTitle": "Retro Tees | Floof",
  "seoDescription": "Shop retro print-on-demand tees at Floof."
}
```

Metadata is stored on `product_collection.metadata` (including a `landing` object for storefront use).

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
MEDUSA_BACKEND_URL=https://api.floof.space
PRINTFUL_AUTO_CONFIRM=true   # false = Printful orders stay draft for manual review
```

Token scopes needed: `sync_products`, `file_library`, and mockup generator access (default private token usually has these).

## Mug mockups & titles

Mockup placement and `option_groups` come from Printful `GET /mockup-generator/printfiles/{catalogProductId}`:

- Apparel uses placement **`front`** and Men's / Women's **Lifestyle** groups (1–4 when available).
- Mugs and similar products use placement **`default`** and neutral **Lifestyle** groups (e.g. Lifestyle, Lifestyle 2, …).

New products use the design **name as-is** (no `FLOOF —` prefix).

### Regenerate mug mockups / strip legacy titles

**CLI** (from `floof-backend` with DB + Printful env):

```bash
yarn regenerate:mug-mockups
```

| Env | Default | Purpose |
|-----|---------|---------|
| `DRY_RUN=1` | off | Log actions only |
| `STRIP_FLOOF_PREFIX=0` | strip on **all** products | Skip title cleanup |
| `REGENERATE_MOCKUPS=0` | regenerate | Skip Printful mockup regen (mugs only) |
| `PRODUCT_IDS` | all mugs | Comma-separated Medusa product ids (mockup regen only) |
| `MUG_CATALOG_PRODUCT_IDS` | `19,483` | Extra catalog ids for mug detection |

Mug mockups use Printful **Lifestyle / Lifestyle 2 / Lifestyle 3** `option_groups` (one task each), placement **`default`**, and layout **templates** to center art on the front of the wrap. The first gallery image is the primary lifestyle shot.

Maintenance responses include a `products` array per mug with `mockupTasks` (request, poll status, URLs), `gallery`, and `imagesChanged`. `mockupsRegenerated` counts only mugs whose Medusa gallery URLs actually changed. Logs include each Printful `create-task` payload and poll status.

**Admin API:**

```http
POST /floof/design-products
x-floof-admin-key: YOUR_KEY
Content-Type: application/json

{
  "maintenance": "regenerateMugMockups",
  "regenerateMockups": true,
  "stripFloofPrefix": true,
  "dryRun": false
}
```

## Notes

- Body limit for Studio uploads is **20mb** JSON (`bodyParser.sizeLimit` on `/floof/design-products`). If you still see `request entity too large`, compress the PNG or host it and use `designUrl` instead.
- Printful **cannot** read local disk paths — URL or Studio upload only.
- Mockup generation is async and can take 30–90s; the API waits and polls.
- If mockups fail, the product still creates using the design file / thumbnail.
- Orders still use `PF-{sync_variant_id}` SKUs (same as `yarn sync:printful`).
- Re-run is not idempotent by design name; handles get a suffix if taken.
