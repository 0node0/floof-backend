import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export type ReplaceGalleryResult = {
  previousUrls: string[]
  nextUrls: string[]
  imagesChanged: boolean
  thumbnailChanged: boolean
}

function normalizeGallery(urls: string[]): string[] {
  const out: string[] = []
  for (const u of urls) {
    const t = u?.trim()
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

export function galleryUrlsChanged(before: string[], after: string[]): boolean {
  const a = normalizeGallery(before)
  const b = normalizeGallery(after)
  if (a.length !== b.length) return true
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return true
  }
  return false
}

/**
 * True when this mockup run produced at least one lifestyle URL that was not already on the product.
 */
export function newLifestyleMockupUrlsAdded(
  before: string[],
  after: string[],
  lifestyleUrlsFromRun: string[]
): boolean {
  const prev = new Set(normalizeGallery(before))
  const next = new Set(normalizeGallery(after))
  const fromRun = normalizeGallery(lifestyleUrlsFromRun)
  if (!fromRun.length) return false
  return fromRun.some((u) => next.has(u) && !prev.has(u))
}

/** Catalog blank / stock photos (not generated mockups). */
export function isStockCatalogImageUrl(url: string): boolean {
  return /files\.cdn\.printful\.com\/products\//i.test(url) || /\/products\/\d+\//i.test(url)
}

/**
 * Replace all product images and thumbnail (soft-deletes old image rows, then upserts new gallery).
 */
export async function replaceProductGalleryImages(
  container: MedusaContainer,
  productId: string,
  imageUrls: string[],
  thumbnailUrl?: string
): Promise<ReplaceGalleryResult> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const productModule = container.resolve(Modules.PRODUCT)
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as {
    (table: string): {
      where: (
        col: string,
        val: string
      ) => {
        whereNull: (c: string) => { update: (row: Record<string, unknown>) => Promise<unknown> }
      }
    }
  }

  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "thumbnail", "images.id", "images.url"],
    filters: { id: productId },
  })

  const product = (data || [])[0] as
    | { id: string; thumbnail?: string; images?: Array<{ id: string; url: string }> }
    | undefined

  if (!product) {
    throw new Error(`Medusa product ${productId} not found`)
  }

  const previousUrls = (product.images || []).map((i) => i.url).filter(Boolean)
  const nextUrls = normalizeGallery(imageUrls)
  const thumb = thumbnailUrl || nextUrls[0] || product.thumbnail || ""

  const now = new Date()
  await pg("image")
    .where("product_id", productId)
    .whereNull("deleted_at")
    .update({ deleted_at: now })

  await productModule.updateProducts(productId, {
    thumbnail: thumb,
    images: nextUrls.map((url, index) => ({ url, rank: index })),
  })

  const imagesChanged = galleryUrlsChanged(previousUrls, nextUrls)
  const thumbnailChanged = (product.thumbnail || "") !== thumb

  return {
    previousUrls,
    nextUrls,
    imagesChanged,
    thumbnailChanged,
  }
}
