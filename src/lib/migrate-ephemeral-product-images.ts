import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import PrintfulApiClient from "../modules/printful/client"
import { ensureDurablePublicImageUrl } from "./durable-public-image"
import { isEphemeralFloofHostedImageUrl } from "./ephemeral-floof-image-url"
import { replaceProductGalleryImages } from "./medusa-product-images"
import { formatErrorMessage } from "./serialize-error"

export type MigrateEphemeralProductImagesInput = {
  dryRun?: boolean
  /** Only migrate products whose handle starts with this prefix (e.g. flower-crown-). */
  handlePrefix?: string
  productIds?: string[]
}

export type ProductImageMigrationRow = {
  productId: string
  handle: string
  title: string
  before: string[]
  after: string[]
  migrated: boolean
  error?: string
}

export type MigrateEphemeralProductImagesResult = {
  scanned: number
  migrated: number
  dryRun: boolean
  products: ProductImageMigrationRow[]
  errors: Array<{ productId: string; error: string }>
  logs: string[]
}

function makeClient(): PrintfulApiClient {
  const token = process.env.PRINTFUL_API_TOKEN || process.env.PRINTFUL_API_KEY || ""
  if (!token) throw new Error("PRINTFUL_API_TOKEN is not set")
  return new PrintfulApiClient(token, process.env.PRINTFUL_STORE_ID)
}

function orderedGalleryUrls(product: {
  thumbnail?: string | null
  images?: Array<{ url?: string | null }> | null
}): string[] {
  const fromImages = (product.images || [])
    .map((i) => i.url?.trim())
    .filter((u): u is string => Boolean(u))
  const thumb = product.thumbnail?.trim()
  if (thumb && !fromImages.includes(thumb)) {
    return [thumb, ...fromImages]
  }
  return fromImages.length ? fromImages : thumb ? [thumb] : []
}

export async function migrateEphemeralProductImages(
  container: MedusaContainer,
  input: MigrateEphemeralProductImagesInput = {}
): Promise<MigrateEphemeralProductImagesResult> {
  const dryRun = input.dryRun === true
  const logs: string[] = []
  const log = (m: string) => {
    logs.push(m)
    console.log(`[migrate-ephemeral-images] ${m}`)
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "handle", "title", "thumbnail", "images.url"],
  })

  const prefix = input.handlePrefix?.trim()
  const idFilter = input.productIds?.length
    ? new Set(input.productIds.map(String))
    : null

  let targets = (products || []) as Array<{
    id: string
    handle: string
    title: string
    thumbnail?: string | null
    images?: Array<{ url?: string | null }> | null
  }>

  if (idFilter) {
    targets = targets.filter((p) => idFilter.has(p.id))
  }
  if (prefix) {
    targets = targets.filter((p) => p.handle.startsWith(prefix))
  }

  const client = makeClient()
  const rows: ProductImageMigrationRow[] = []
  const errors: Array<{ productId: string; error: string }> = []
  let migrated = 0
  let scannedWithEphemeral = 0

  for (const product of targets) {
    const before = orderedGalleryUrls(product)
    const needsWork = before.some((u) => isEphemeralFloofHostedImageUrl(u))
    if (!needsWork) {
      continue
    }
    scannedWithEphemeral++

    const row: ProductImageMigrationRow = {
      productId: product.id,
      handle: product.handle,
      title: product.title,
      before,
      after: [],
      migrated: false,
    }

    try {
      const after: string[] = []
      let anyChanged = false
      for (const url of before) {
        if (isEphemeralFloofHostedImageUrl(url)) {
          const durable = await ensureDurablePublicImageUrl(url, log, client, {
            r2ObjectKey: `products/${product.handle}-art.png`,
          })
          after.push(durable)
          anyChanged = anyChanged || durable !== url
        } else {
          after.push(url)
        }
      }

      row.after = after
      if (!anyChanged) {
        rows.push(row)
        continue
      }

      if (dryRun) {
        log(`Dry run ${product.handle}: would migrate ${before.length} url(s)`)
        row.migrated = false
        rows.push(row)
        continue
      }

      await replaceProductGalleryImages(container, product.id, after, after[0])
      row.migrated = true
      migrated++
      log(`✓ ${product.handle}: gallery updated (${before.length} → durable URLs)`)
      rows.push(row)
    } catch (e: unknown) {
      const msg = formatErrorMessage(e)
      row.error = msg
      errors.push({ productId: product.id, error: msg })
      rows.push(row)
      log(`✗ ${product.handle}: ${msg}`)
    }
  }

  return {
    scanned: scannedWithEphemeral,
    migrated,
    dryRun,
    products: rows,
    errors,
    logs,
  }
}
