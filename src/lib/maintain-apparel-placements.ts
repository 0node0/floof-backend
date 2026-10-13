import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import {
  detectApparelIsHoodie,
  parseApparelLayout,
  planApparelPlacementLayout,
  type ApparelPlacementLayout,
  type ApparelPlacementPlanEntry,
} from "./apparel-placement-layout"
import { buildApparelPrintFilesForPlacements } from "./apparel-print-file"
import { formatErrorMessage } from "./serialize-error"
import { generateApparelPlacementMockups } from "./product-from-design"
import {
  DESIGN_SOURCE_FILE_ID_META,
  DESIGN_SOURCE_URL_META,
  resolveMugDesignSource,
} from "./mug-design-source"
import { replaceProductGalleryImages } from "./medusa-product-images"
import { syncMedusaProductVariantsUpdateOnly } from "./medusa-printful-variant-sync"
import PrintfulApiClient from "../modules/printful/client"
import type { PrintfilesApiResult } from "./printful-mockup-config"
import { updateSyncVariantsPrintFilesIdempotent } from "./printful-apparel-sync"
import { sleep } from "./async-sleep"
import { withPrintfulRetries } from "./printful-retry"
import type { MockupTaskRunLog } from "./printful-mockup-generator"

export type MaintainApparelPlacementsInput = {
  dryRun?: boolean
  layouts?: Record<string, ApparelPlacementLayout>
  productIds?: string[]
  products?: Array<{ productId: string; layout: ApparelPlacementLayout }>
  sourceUrls?: Record<string, string>
}

export type ApparelVariantPriceReport = {
  variantId: string
  sku?: string
  amount: number
  currency_code: string
}

export type ApparelProductMaintenanceResult = {
  productId: string
  handle: string
  layout: ApparelPlacementLayout
  printfulProductId?: number
  regenerated: boolean
  imagesChanged: boolean
  dryRun?: boolean
  plannedPlacements?: ApparelPlacementPlanEntry[]
  printFiles: Array<{
    placement: string
    syncFileType: string
    fileId?: number
    url?: string
    position: Record<string, number>
    positionInches?: ApparelPlacementPlanEntry["inches"]
  }>
  mockupUrls: string[]
  mockupTasks: MockupTaskRunLog[]
  prices: ApparelVariantPriceReport[]
  syncVariantsUpdated?: number
  error?: string
}

export type MaintainApparelPlacementsResult = {
  scanned: number
  processed: number
  products: ApparelProductMaintenanceResult[]
  errors: Array<{ productId: string; error: string }>
  logs: string[]
}

function makeClient(): PrintfulApiClient {
  const token = process.env.PRINTFUL_API_TOKEN || process.env.PRINTFUL_API_KEY || ""
  if (!token) throw new Error("PRINTFUL_API_TOKEN is not set")
  return new PrintfulApiClient(token, process.env.PRINTFUL_STORE_ID)
}

export function resolveLayoutMap(
  input: MaintainApparelPlacementsInput
): Map<string, ApparelPlacementLayout> {
  const map = new Map<string, ApparelPlacementLayout>()
  if (input.products?.length) {
    for (const row of input.products) {
      const layout = parseApparelLayout(row.layout)
      if (layout && row.productId) map.set(String(row.productId), layout)
    }
  }
  if (input.layouts) {
    for (const [id, layoutRaw] of Object.entries(input.layouts)) {
      const layout = parseApparelLayout(layoutRaw)
      if (layout) map.set(id, layout)
    }
  }
  if (input.productIds?.length && input.layouts) {
    for (const id of input.productIds) {
      const layout = parseApparelLayout(input.layouts[id])
      if (layout) map.set(id, layout)
    }
  }
  return map
}

async function loadMedusaVariantPrices(
  container: MedusaContainer,
  productId: string
): Promise<ApparelVariantPriceReport[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "variants.id",
      "variants.sku",
      "variants.prices.amount",
      "variants.prices.currency_code",
    ],
    filters: { id: productId },
  })
  const product = (data || [])[0] as {
    variants?: Array<{
      id: string
      sku?: string
      prices?: Array<{ amount?: number; currency_code?: string }>
    }>
  }
  const out: ApparelVariantPriceReport[] = []
  for (const v of product?.variants || []) {
    const price = v.prices?.[0]
    if (!price?.amount) continue
    out.push({
      variantId: v.id,
      sku: v.sku,
      amount: price.amount,
      currency_code: price.currency_code || "usd",
    })
  }
  return out
}

function resolveSourceUrlFromMap(
  map: Record<string, string> | undefined,
  product: { id: string; handle: string }
): string | undefined {
  if (!map) return undefined
  if (map[product.id]) return map[product.id]
  if (map[product.handle]) return map[product.handle]
  return undefined
}

export async function maintainApparelPlacements(
  container: MedusaContainer,
  input: MaintainApparelPlacementsInput = {}
): Promise<MaintainApparelPlacementsResult> {
  const logs: string[] = []
  const log = (m: string) => {
    logs.push(m)
    console.log(`[maintain-apparel-placements] ${m}`)
  }

  const layoutMap = resolveLayoutMap(input)
  if (!layoutMap.size) {
    throw new Error(
      "regenerateApparelPlacements requires layouts per product (layouts map or products array)"
    )
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
  }>

  const targets = all.filter((p) => layoutMap.has(p.id))
  log(`Scanned ${all.length} product(s); ${targets.length} targeted for apparel placement regen`)

  const errors: MaintainApparelPlacementsResult["errors"] = []
  const productResults: ApparelProductMaintenanceResult[] = []
  const gapMs = Number(process.env.APPAREL_PLACEMENT_REGEN_DELAY_MS || 4000)
  const client = makeClient()

  for (let i = 0; i < targets.length; i++) {
    const product = targets[i]
    const layout = layoutMap.get(product.id)!
    const base: ApparelProductMaintenanceResult = {
      productId: product.id,
      handle: product.handle,
      layout,
      regenerated: false,
      imagesChanged: false,
      printFiles: [],
      mockupUrls: [],
      mockupTasks: [],
      prices: [],
    }

    if (i > 0) {
      log(`Waiting ${gapMs}ms before next product`)
      await sleep(gapMs)
    }

    const printfulId = Number(product.metadata?.printful_product_id)
    if (!printfulId) {
      base.error = "missing printful_product_id metadata"
      errors.push({ productId: product.id, error: base.error })
      productResults.push(base)
      continue
    }
    base.printfulProductId = printfulId

    const catalogProductId = Number(product.metadata?.printful_catalog_product_id)
    if (!catalogProductId) {
      base.error = "missing printful_catalog_product_id metadata"
      errors.push({ productId: product.id, error: base.error })
      productResults.push(base)
      continue
    }

    try {
      const detail = await withPrintfulRetries(
        `GET Printful product ${printfulId}`,
        log,
        () => client.get<any>(`/store/products/${printfulId}`)
      )
      const syncVariants: any[] = detail.sync_variants || []
      if (!syncVariants.length && !input.dryRun) {
        throw new Error(`Printful product ${printfulId} has no sync variants`)
      }

      const variantIds = syncVariants
        .map((v: { variant_id?: number }) => v.variant_id)
        .filter(Boolean)
        .slice(0, 4) as number[]

      const printfilesRaw = await withPrintfulRetries(
        `GET printfiles ${catalogProductId}`,
        log,
        () =>
          client.get<PrintfilesApiResult>(
            `/mockup-generator/printfiles/${catalogProductId}`
          )
      )

      const isHoodie = detectApparelIsHoodie({
        title: product.title,
        handle: product.handle,
        category:
          typeof product.metadata?.category === "string"
            ? product.metadata.category
            : undefined,
        catalogProductId,
      })
      const layoutPlan = planApparelPlacementLayout(
        layout,
        printfilesRaw,
        variantIds.length ? variantIds : [1],
        isHoodie
      )
      base.plannedPlacements = layoutPlan.planned
      base.dryRun = input.dryRun === true
      base.printFiles = layoutPlan.planned.map((p) => ({
        placement: p.placement,
        syncFileType: p.syncFileType,
        position: p.position,
        positionInches: p.inches,
      }))

      if (input.dryRun) {
        base.regenerated = false
        productResults.push(base)
        log(`Dry run ${product.handle}: ${JSON.stringify(layoutPlan.planned)}`)
        continue
      }

      base.prices = await loadMedusaVariantPrices(container, product.id)

      const designSource = await withPrintfulRetries(
        "Resolve design source",
        log,
        () =>
          resolveMugDesignSource(client, {
            medusaProductId: product.id,
            title: product.title,
            handle: product.handle,
            phrase:
              typeof product.metadata?.phrase === "string"
                ? product.metadata.phrase
                : undefined,
            metadata: product.metadata,
            sourceUrlOverride: resolveSourceUrlFromMap(input.sourceUrls, product),
            log,
          })
      )
      if (!designSource?.url) {
        throw new Error(
          "no design source (set metadata designSourceFileId or sourceUrls[productId])"
        )
      }

      const printFiles = await buildApparelPrintFilesForPlacements(
        client,
        designSource.url,
        layoutPlan.placements,
        log
      )
      base.printFiles = printFiles.map((f) => {
        const planned = layoutPlan.planned.find((p) => p.placement === f.placement)
        return {
          placement: f.placement,
          syncFileType: f.syncFileType,
          fileId: f.fileId,
          url: f.cdnUrl,
          position: f.position,
          positionInches: planned?.inches,
        }
      })

      const syncFileRefs = printFiles
        .filter((f) => f.fileId != null)
        .map((f) => ({
          fileId: f.fileId!,
          type: f.syncFileType,
        }))
      const syncStats = await updateSyncVariantsPrintFilesIdempotent(
        client,
        printfulId,
        syncVariants,
        syncFileRefs,
        log
      )
      base.syncVariantsUpdated = syncStats.updated

      const mockupInputs = printFiles
        .filter((f) => f.cdnUrl)
        .map((f) => ({
          placement: f.placement,
          cdnUrl: f.cdnUrl!,
          mockupPosition: f.mockupPosition,
        }))

      const mockupResult = await generateApparelPlacementMockups({
        client,
        catalogProductId,
        variantIds,
        printFiles: mockupInputs,
        log,
      })
      base.mockupTasks = mockupResult.mockupTasks
      base.mockupUrls = mockupResult.gallery
      base.regenerated = mockupResult.mockupTasks.length > 0

      if (mockupResult.gallery.length) {
        const replaced = await replaceProductGalleryImages(
          container,
          product.id,
          mockupResult.gallery,
          mockupResult.gallery[0]
        )
        base.imagesChanged = replaced.imagesChanged
      }

      await syncMedusaProductVariantsUpdateOnly(
        container,
        product.id,
        syncVariants,
        syncVariants[0]?.retail_price || "28.00",
        log
      )

      const backfill = designSource.backfillMetadata
      if (backfill?.designSourceFileId || backfill?.designSourceUrl) {
        await updateProductsWorkflow(container).run({
          input: {
            products: [
              {
                id: product.id,
                metadata: {
                  ...(backfill.designSourceFileId != null
                    ? { [DESIGN_SOURCE_FILE_ID_META]: backfill.designSourceFileId }
                    : {}),
                  ...(backfill.designSourceUrl
                    ? { [DESIGN_SOURCE_URL_META]: backfill.designSourceUrl }
                    : {}),
                },
              },
            ],
          } as any,
        })
      }

      base.prices = await loadMedusaVariantPrices(container, product.id)
      productResults.push(base)
      log(`✓ ${product.handle} layout=${layout} mockups=${base.mockupUrls.length}`)
    } catch (e: unknown) {
      const msg = formatErrorMessage(e)
      base.error = msg
      errors.push({ productId: product.id, error: msg })
      productResults.push(base)
      log(`✗ ${product.handle}: ${msg}`)
    }
  }

  return {
    scanned: all.length,
    processed: targets.length,
    products: productResults,
    errors,
    logs,
  }
}
