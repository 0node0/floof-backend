import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import { importPrintfulProductToMedusa } from "./product-from-design"
import { stripFloofProductTitle } from "./printful-mockup-config"
import type { MockupTaskRunLog } from "./printful-mockup-generator"

export type MaintainMugProductsInput = {
  /** Regenerate Printful lifestyle mockups and refresh Medusa gallery images (mugs only) */
  regenerateMockups?: boolean
  /** Strip legacy "FLOOF —" from Medusa product titles (all products) */
  stripFloofPrefix?: boolean
  /** Limit mockup regen to these Medusa product ids */
  productIds?: string[]
  /** Dry run — log actions only */
  dryRun?: boolean
}

export type MugProductMaintenanceResult = {
  productId: string
  handle: string
  printfulProductId?: number
  regenerated: boolean
  imagesChanged: boolean
  gallery: string[]
  mockupTasks: MockupTaskRunLog[]
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
    fields: ["id", "title", "handle", "description", "metadata"],
  })

  const all = (products || []) as Array<{
    id: string
    title: string
    handle: string
    description?: string
    metadata?: Record<string, unknown>
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
  if (input.productIds?.length) {
    mugCandidates = mugCandidates.filter((p) => input.productIds!.includes(p.id))
  } else {
    mugCandidates = mugCandidates.filter((p) => p.metadata?.printful_product_id != null)
  }

  log(`${mugCandidates.length} mug candidate(s) for mockup regen`)

  if (input.regenerateMockups) {
    for (const product of mugCandidates) {
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
        base.regenerated = changed
        base.imagesChanged = changed
        base.gallery = result.gallery || []
        base.mockupTasks = result.mockupTasks || []

        if (changed) {
          mockupsRegenerated++
          log(`✓ ${product.handle}: gallery updated (${base.gallery.length} images)`)
        } else {
          log(`○ ${product.handle}: mockup run finished but Medusa gallery unchanged`)
        }
        productResults.push(base)
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
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
