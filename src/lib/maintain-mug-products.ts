import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import { resolveSourceUrlFromMap } from "./mug-design-source"
import { formatErrorMessage } from "./serialize-error"
import {
  importPrintfulProductToMedusa,
  type CreateFromDesignResult,
} from "./product-from-design"
import { stripFloofProductTitle } from "./printful-mockup-config"
import type { MockupTaskRunLog } from "./printful-mockup-generator"
import type { SyncVariantFileReport } from "./printful-mug-sync"
import type { MugMockupSceneResult } from "./mug-mockup-scene-runner"
import { sleep } from "./async-sleep"

export type MaintainMugProductsInput = {
  /** Regenerate Printful lifestyle mockups and refresh Medusa gallery images (mugs only) */
  regenerateMockups?: boolean
  /** Strip legacy "FLOOF —" from Medusa product titles (all products) */
  stripFloofPrefix?: boolean
  /** Limit mockup regen to these Medusa product ids */
  productIds?: string[]
  /** Match Medusa id, handle, or title (case-insensitive substring) */
  regenerateProducts?: string[]
  /** Dry run — log actions only */
  dryRun?: boolean
  /**
   * Only regenerate mugs whose Medusa gallery has fewer than this many images.
   * Use `2` to target mugs stuck with a single lifestyle shot.
   */
  onlyIfGalleryImagesBelow?: number
  /** Original single-sided design URLs keyed by Medusa product id or handle */
  sourceUrls?: Record<string, string>
  /** Regenerate every mug with a Printful sync id (all 13), ignoring sparse-gallery filter */
  regenerateAllMugs?: boolean
}

export type MugProductMaintenanceResult = {
  productId: string
  handle: string
  printfulProductId?: number
  regenerated: boolean
  imagesChanged: boolean
  gallery: string[]
  mockupTasks: MockupTaskRunLog[]
  mockupSkipReason?: string
  mockupScenes?: MugMockupSceneResult[]
  syncVariants?: SyncVariantFileReport[]
  mugDesignSource?: CreateFromDesignResult["mugDesignSource"]
  mugWrapLayout?: CreateFromDesignResult["mugWrapLayout"]
  error?: string
}

export type MaintainMugProductsResult = {
  scanned: number
  /** @deprecated use mugMatched */
  matched: number
  mugMatched: number
  titlesUpdated: number
  mockupsRegenerated: number
  products: MugProductMaintenanceResult[]
  errors: Array<{ productId: string; error: string }>
  logs: string[]
}

function mugCatalogIdsFromEnv(): Set<string> {
  const raw =
    process.env.MUG_CATALOG_PRODUCT_IDS ||
    process.env.MUG_CATALOG_PRODUCT_ID ||
    "19,483"
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  )
}

export function productMatchesRegenerateList(
  product: { id: string; title: string; handle: string },
  namesOrIds: string[]
): boolean {
  for (const token of namesOrIds) {
    const t = token.trim()
    if (!t) continue
    if (product.id === t || product.handle === t) return true
    if (product.title.toLowerCase().includes(t.toLowerCase())) return true
    if (product.handle.toLowerCase().includes(t.toLowerCase())) return true
  }
  return false
}

export function countProductGalleryImages(product: {
  images?: Array<{ url?: string | null }>
}): number {
  const urls = new Set<string>()
  for (const img of product.images || []) {
    const u = img.url?.trim()
    if (u) urls.add(u)
  }
  return urls.size
}

export function looksLikeMug(product: {
  title?: string
  handle?: string
  description?: string
  metadata?: Record<string, unknown>
}): boolean {
  const blob = `${product.title || ""} ${product.handle || ""} ${product.description || ""} ${
    product.metadata?.phrase || ""
  }`.toLowerCase()
  if (blob.includes("mug")) return true
  const cat = String(product.metadata?.category || "").toLowerCase()
  if (cat === "accessories" && blob.includes("drink")) return true
  const catalogId = product.metadata?.printful_catalog_product_id
  if (catalogId != null && mugCatalogIdsFromEnv().has(String(catalogId))) return true
  return false
}

/**
 * Regenerate mockups for existing mug products and/or strip FLOOF title prefixes.
 * Title cleanup runs for every product; mockup regen is mug-only.
 */
export async function maintainMugDesignProducts(
  container: MedusaContainer,
  input: MaintainMugProductsInput = {}
): Promise<MaintainMugProductsResult> {
  const logs: string[] = []
  const log = (m: string) => {
    logs.push(m)
    console.log(`[maintain-mug-products] ${m}`)
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle", "description", "metadata", "images.url"],
  })

  const all = (products || []) as Array<{
    id: string
    title: string
    handle: string
    description?: string
    metadata?: Record<string, unknown>
    images?: Array<{ url?: string | null }>
  }>

  log(`Scanned ${all.length} product(s)${input.dryRun ? " (dry run)" : ""}`)

  const errors: MaintainMugProductsResult["errors"] = []
  const productResults: MugProductMaintenanceResult[] = []
  let titlesUpdated = 0
  let mockupsRegenerated = 0

  if (input.stripFloofPrefix) {
    for (const product of all) {
      const cleanedTitle = stripFloofProductTitle(product.title)
      if (cleanedTitle === product.title) continue
      log(`Title: "${product.title}" → "${cleanedTitle}" (${product.handle})`)
      if (!input.dryRun) {
        try {
          await updateProductsWorkflow(container).run({
            input: {
              products: [{ id: product.id, title: cleanedTitle }],
            } as any,
          })
          titlesUpdated++
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          errors.push({ productId: product.id, error: `title update: ${msg}` })
        }
      } else {
        titlesUpdated++
      }
    }
  }

  let mugCandidates = all.filter((p) => looksLikeMug(p))
  if (input.regenerateAllMugs) {
    mugCandidates = mugCandidates.filter((p) => p.metadata?.printful_product_id != null)
    log(`regenerateAllMugs: ${mugCandidates.length} mug(s) with Printful sync`)
  } else {
    const regenList = [
      ...(input.productIds || []),
      ...(input.regenerateProducts || []),
    ].filter(Boolean)
    if (regenList.length) {
      mugCandidates = mugCandidates.filter((p) => productMatchesRegenerateList(p, regenList))
    } else {
      mugCandidates = mugCandidates.filter((p) => p.metadata?.printful_product_id != null)
    }
  }

  if (input.onlyIfGalleryImagesBelow != null && !input.regenerateAllMugs) {
    const threshold = input.onlyIfGalleryImagesBelow
    const before = mugCandidates.length
    mugCandidates = mugCandidates.filter(
      (p) => countProductGalleryImages(p) < threshold
    )
    log(
      `Sparse gallery filter (<${threshold} images): ${mugCandidates.length}/${before} mug(s)`
    )
  }

  log(`${mugCandidates.length} mug candidate(s) for mockup regen`)

  const mugGapMs = Number(process.env.MUG_MOCKUP_REGEN_DELAY_MS || 4000)

  if (input.regenerateMockups) {
    for (let mugIndex = 0; mugIndex < mugCandidates.length; mugIndex++) {
      const product = mugCandidates[mugIndex]
      if (mugIndex > 0) {
        log(`Waiting ${mugGapMs}ms before next mug (rate limits)`)
        await sleep(mugGapMs)
      }
      const printfulId = Number(product.metadata?.printful_product_id)
      const base: MugProductMaintenanceResult = {
        productId: product.id,
        handle: product.handle,
        printfulProductId: printfulId || undefined,
        regenerated: false,
        imagesChanged: false,
        gallery: [],
        mockupTasks: [],
      }

      if (!printfulId) {
        base.error = "missing printful_product_id metadata"
        productResults.push(base)
        continue
      }

      log(`Regenerating mockups for Printful #${printfulId} (${product.handle})`)
      if (input.dryRun) {
        base.regenerated = true
        productResults.push(base)
        continue
      }

      try {
        const result = await importPrintfulProductToMedusa(printfulId, container, {
          regenerateMockups: true,
          medusaProductId: product.id,
          medusaHandle: product.handle,
          medusaMetadata: product.metadata,
          sourceUrlOverride: resolveSourceUrlFromMap(input.sourceUrls, product),
          catalogProductId: product.metadata?.printful_catalog_product_id
            ? Number(product.metadata.printful_catalog_product_id)
            : undefined,
          category:
            typeof product.metadata?.category === "string"
              ? product.metadata.category
              : "accessories",
          phrase:
            typeof product.metadata?.phrase === "string" ? product.metadata.phrase : undefined,
        })

        const changed = result.imagesChanged === true
        base.imagesChanged = changed
        base.gallery = result.gallery || []
        base.mockupTasks = result.mockupTasks || []
        base.mockupSkipReason = result.mockupSkipReason
        base.mockupScenes = result.mockupScenes
        base.syncVariants = result.syncVariantFiles
        base.mugDesignSource = result.mugDesignSource
        base.mugWrapLayout = result.mugWrapLayout
        base.regenerated = base.mockupTasks.length > 0

        if (result.mugDesignSource) {
          log(
            `Design source for ${product.handle}: ${JSON.stringify(result.mugDesignSource)}`
          )
        }
        if (result.mugWrapLayout) {
          log(`Wrap layout for ${product.handle}: ${JSON.stringify(result.mugWrapLayout)}`)
        }

        if (changed) {
          mockupsRegenerated++
          log(`✓ ${product.handle}: gallery saved (${base.gallery.length} images)`)
        } else if (base.mockupTasks.length) {
          log(`○ ${product.handle}: ${base.mockupTasks.length} mockup task(s) — gallery unchanged`)
        } else {
          log(
            `○ ${product.handle}: no mockup tasks — ${base.mockupSkipReason || "unknown reason"}`
          )
        }
        productResults.push(base)
      } catch (e: unknown) {
        const msg = formatErrorMessage(e)
        base.error = msg
        errors.push({ productId: product.id, error: `mockups: ${msg}` })
        productResults.push(base)
      }
    }
  }

  const mugMatched = mugCandidates.length
  return {
    scanned: all.length,
    matched: mugMatched,
    mugMatched,
    titlesUpdated,
    mockupsRegenerated,
    products: productResults,
    errors,
    logs,
  }
}
