# Mug design source files

Mug wrap regeneration must **never** use the sync variant’s current print file or any `mug-wrap-*.png` composite. Source art is resolved in this order:

1. Job body `sourceUrls[medusaProductId]` or `sourceUrls[handle]`
2. Medusa `metadata.designSourceUrl` / `metadata.designSourceFileId`
3. Printful file library: **oldest** file whose filename matches the product slug/handle and is **not** a wrap

New products store `designSourceFileId` and `designSourceUrl` at creation (the first `/files` registration from `designUrl`).

## Eight mugs from job `mug_mv639mjj_mzufo5h3` (after backfill)

Resolution uses the **lowest Printful file id** among library entries matching `{slug}.png` (creation upload), excluding `mug-wrap-2700x1050.png`. Example for Labrador Retriever mug: `files/c47/c47f9101…` (single design), **not** the later `9cc…` composite.

| Product | Typical Medusa handle | Expected Printful filename match |
| --- | --- | --- |
| Professional Snuggler | `professional-snuggler` or `pro-snuggler` | `professional-snuggler.png` |
| Has Opinions | `has-opinions` | `has-opinions.png` |
| Aussie | `aussie` | `aussie.png` |
| One Dog Long | `one-dog-long` | `one-dog-long.png` |
| Bookmark | `bookmark` | `bookmark.png` |
| Dog-Ear Club | `dog-ear-club` | `dog-ear-club.png` |
| I Prefer Hardcover | `i-prefer-hardcover` | `i-prefer-hardcover.png` |
| Camera Off Club | `camera-off-club` | `camera-off-club.png` |

After maintenance runs, check job logs for `Discovered design source from file library: id=…` or persist overrides via `sourceUrls` if a slug collision exists.

## Layout guard

After compositing, each half of the wrap must have one ink cluster with height ≥ 60% of wrap height. Failures skip sync variant and gallery updates.
