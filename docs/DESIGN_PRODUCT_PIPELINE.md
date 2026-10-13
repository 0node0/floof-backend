# Design → Printful → Floof product pipeline

Upload a PNG design, create a Printful sync product (with product + lifestyle mockups), and publish it on the Floof Medusa storefront.

## Flow

```
PNG (URL or Studio upload)
    → stage public URL (R2 when configured, else short-lived in-memory route)
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

Set `R2_*` env vars for **durable** design uploads (recommended). Otherwise set `MEDUSA_BACKEND_URL` to the public backend URL so Printful can fetch `/floof/design-files/…` (not durable across redeploys).

Mockup regen uses durable Printful URLs. **Mug wrap regen** uses only original single-sided art (`metadata.designSourceFileId`, job `sourceUrls`, or file-library backfill) — never the sync variant’s current wrap file. Wrap composites are validated before updating variants.

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
R2_ACCOUNT_ID=…
R2_ACCESS_KEY_ID=…
R2_SECRET_ACCESS_KEY=…
R2_BUCKET=floof-designs
R2_PUBLIC_BASE_URL=https://designs.floof.space
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

Regenerate a named set with `regenerateProducts` (Medusa id, handle, or title substring) or `productIds`. Mug wrap compositing always uses **single-sided** artwork — if the sync variant already points at a full wrap file, the pipeline extracts the front panel before re-compositing (avoids double-shrink regression).

Mug mockups use **Lifestyle** and **Lifestyle 2** (and other non-blocked scenes; **Lifestyle 3** / hands-from-below is skipped because art mirrors). Placement **`default`**. The same **dual-panel wrap composite** is applied to **sync variant print files** and mockup tasks. Medusa gallery is **2–3 lifestyle images only** (no flat art or handle-side previews) when mockups exist.

**Async maintenance (default):** `POST` with `maintenance: "regenerateMugMockups"` returns **202** with `jobId` and `statusUrl`. Poll **`GET /floof/maintenance-jobs/:jobId`** (same admin key) for `status` (`queued` → `running` → `completed`) and full per-mug `result.products`. Pass `"sync": true` to block until finished (may hit proxy timeouts).

Completed jobs include a `products` array per mug with `mockupTasks`, **`mockupScenes`** (per-scene success, URL, error, attempts), `gallery`, and `imagesChanged`. Gallery order puts **handheld close-up (Lifestyle 2)** first. Pass **`onlySparseGalleries: true`** (or `onlyIfGalleryImagesBelow: 2`) to regen only mugs with fewer than 2 Medusa images. Failed scenes are retried with throttling until 2–3 scenes succeed when possible.

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

Poll:

```http
GET /floof/maintenance-jobs/{jobId}
x-floof-admin-key: YOUR_KEY
```

## Notes

- Body limit for Studio uploads is **20mb** JSON (`bodyParser.sizeLimit` on `/floof/design-products`). If you still see `request entity too large`, compress the PNG or host it and use `designUrl` instead.
- Printful **cannot** read local disk paths — URL or Studio upload only.
- Mockup generation is async and can take 30–90s; the API waits and polls.
- If mockups fail, the product still creates using the design file / thumbnail.
- Orders still use `PF-{sync_variant_id}` SKUs (same as `yarn sync:printful`).
- Re-run is not idempotent by design name; handles get a suffix if taken.
