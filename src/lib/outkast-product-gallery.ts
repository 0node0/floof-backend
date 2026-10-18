import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import sharp from "sharp"
import PrintfulApiClient from "../modules/printful/client"
import { buildCentredFrontPosition, detectApparelIsHoodie } from "./apparel-placement-layout"
import { extractMockupCandidatesFromTask } from "./apparel-mockup-candidates"
import { ensureDurablePublicImageUrl } from "./durable-public-image"
import {
  listPrintfulMockupStyles,
  outkastGallerySlotsFromPlan,
  planOutkastGalleryStyles,
  type ListMockupStylesResult,
  type MockupStyleCategory,
} from "./mockup-style-catalog"
import {
  buildPrintPositionFromPrintfiles,
  findPrintfileDimensions,
  printfileIdForPlacement,
  type PrintfilesApiResult,
} from "./printful-mockup-config"
import { resolveDurablePrintfulDesignUrl } from "./printful-design-url"
import {
  buildApparelMockupFilePayload,
  mockupCreateOptionsForPlacement,
  resolveArtworkUrlForMockup,
} from "./printful-mockup-request"
import { runPrintfulMockupTask, type MockupCreateTaskRequest } from "./printful-mockup-generator"
import { uploadPngToPrintfulFileLibrary } from "./printful-file-upload"
import { resolveFullPrintfulFileUrlById } from "./printful-file-url"
import { formatErrorMessage } from "./serialize-error"
import { withPrintfulRetries } from "./printful-retry"
import { throttlePrintfulMockupCreateTask } from "./printful-mockup-rate-limit"
import { readDesignSourceFromMetadata } from "./mug-design-source"
import { applyApparelProductGallery } from "./maintain-apparel-placements"

export type GenerateOutkastGalleryInput = {
  handle: string
  dryRun?: boolean
  /** When true and dryRun is false, rehost mockup URLs to Printful CDN / R2. */
  persistDurable?: boolean
  /** When true, replace Medusa gallery (off by default). */
  applyToProduct?: boolean
  maxColors?: number
}

export type OutkastGalleryShot = {
  role: "ghost-front" | "zoomed-in" | "back" | "product-details"
  status: "ok" | "failed"
  optionGroup: string
  category: MockupStyleCategory
  placement: string
  color?: string
  variantId?: number
  option?: string
  view?: string
  mockupUrl?: string
  durableUrl?: string
  error?: string
}

export type GenerateOutkastGalleryResult = {
  handle: string
  productId: string
  catalogProductId: number
  printfulProductId: number
  dryRun: boolean
  persistDurable: boolean
  appliedToProduct: boolean
  styles: ListMockupStylesResult
  plan: ReturnType<typeof planOutkastGalleryStyles>
  shots: OutkastGalleryShot[]
  galleryUrls: string[]
  logs: string[]
}

function makeClient(): PrintfulApiClient {
  const token = process.env.PRINTFUL_API_TOKEN || process.env.PRINTFUL_API_KEY || ""
  if (!token) throw new Error("PRINTFUL_API_TOKEN is not set")
  return new PrintfulApiClient(token, process.env.PRINTFUL_STORE_ID)
}

type SyncVariantRow = {
  id: number
  variant_id?: number
  name?: string
  color?: string
  files?: Array<{ id?: number; type?: string; url?: string }>
}

function colorKeyForSyncVariant(sv: SyncVariantRow): string {
  if (sv.color?.trim()) return sv.color.trim()
  const name = sv.name || ""
  const slash = name.split("/")[0]?.trim()
  return slash || name.trim() || `variant-${sv.variant_id || sv.id}`
}

function representativeVariantsByColor(
  syncVariants: SyncVariantRow[],
  maxColors: number
): Array<{ color: string; variantId: number; syncVariantId: number }> {
  const out: Array<{ color: string; variantId: number; syncVariantId: number }> = []
  const seen = new Set<string>()
  for (const sv of syncVariants) {
    const vid = sv.variant_id
    if (!vid) continue
    const color = colorKeyForSyncVariant(sv)
    const key = color.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ color, variantId: vid, syncVariantId: sv.id })
    if (out.length >= maxColors) break
  }
  if (!out.length && syncVariants[0]?.variant_id) {
    out.push({
      color: colorKeyForSyncVariant(syncVariants[0]),
      variantId: syncVariants[0].variant_id!,
      syncVariantId: syncVariants[0].id,
    })
  }
  return out
}

async function blankPrintFileUrl(
  client: PrintfulApiClient,
  areaW: number,
  areaH: number,
  log: (m: string) => void
): Promise<string> {
  const png = await sharp({
    create: {
      width: areaW,
      height: areaH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer()
  const uploaded = await uploadPngToPrintfulFileLibrary(
    client,
    png,
    `outkast-blank-${areaW}x${areaH}.png`,
    log
  )
  const full = await resolveFullPrintfulFileUrlById(client, uploaded.fileId, log)
  return full?.url || uploaded.cdnUrl
}

function pickBestCandidateUrl(
  poll: { mockups?: unknown[] },
  optionGroup: string,
  placement: string,
  variantId?: number
): { url: string; option?: string; view?: string } | null {
  const candidates = extractMockupCandidatesFromTask(
    poll as import("./printful-mockup-generator").PrintfulMockupTaskResult,
    optionGroup,
    placement
  )
  const filtered = variantId
    ? candidates.filter((c) => c.variantIds?.includes(variantId))
    : candidates
  const pool = filtered.length ? filtered : candidates
  const frontish = pool.find((c) => c.view === "front" || c.isMainMockupUrl) || pool[0]
  if (!frontish?.url) return null
  return { url: frontish.url, option: frontish.option, view: frontish.view }
}

export async function generateOutkastGalleryForProduct(
  container: MedusaContainer,
  input: GenerateOutkastGalleryInput
): Promise<GenerateOutkastGalleryResult> {
  const handle = String(input.handle || "").trim()
  if (!handle) throw new Error("generateGallery requires handle")

  const dryRun = input.dryRun !== false
  const persistDurable =
    !dryRun && (input.persistDurable === true || input.persistDurable !== false)
  const applyToProduct = input.applyToProduct === true
  const maxColors = Math.min(
    12,
    Math.max(1, input.maxColors ?? (dryRun ? 1 : 6))
  )

  const logs: string[] = []
  const log = (m: string) => {
    logs.push(m)
    console.log(`[generateGallery] ${m}`)
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle", "metadata", "images.url"],
    filters: { handle },
  })
  const product = (data || [])[0] as
    | {
        id: string
        title: string
        handle: string
        metadata?: Record<string, unknown>
        images?: Array<{ url?: string | null }>
      }
    | undefined
  if (!product) {
    throw new Error(`Medusa product not found for handle=${handle}`)
  }

  const printfulProductId = Number(product.metadata?.printful_product_id)
  const catalogProductId = Number(product.metadata?.printful_catalog_product_id)
  if (!printfulProductId || !catalogProductId) {
    throw new Error("Product missing printful_product_id or printful_catalog_product_id metadata")
  }

  const client = makeClient()
  const styles = await listPrintfulMockupStyles(client, catalogProductId)
  const plan = planOutkastGalleryStyles(styles.optionGroups.map((g) => g.name))

  const detail = await withPrintfulRetries(
    `GET Printful product ${printfulProductId}`,
    log,
    () => client.get<{ sync_variants?: SyncVariantRow[] }>(`/store/products/${printfulProductId}`)
  )
  const syncVariants = detail.sync_variants || []
  const colorVariants = representativeVariantsByColor(syncVariants, maxColors)
  const variantIds = colorVariants.map((c) => c.variantId)

  const printfilesRaw = await client.get<PrintfilesApiResult>(
    `/mockup-generator/printfiles/${catalogProductId}`
  )
  const isHoodie = detectApparelIsHoodie({
    title: product.title,
    handle: product.handle,
    category:
      typeof product.metadata?.category === "string" ? product.metadata.category : undefined,
    catalogProductId,
  })

  const frontDims = findPrintfileDimensions(
    printfilesRaw.printfiles || [],
    printfileIdForPlacement(printfilesRaw.variant_printfiles, variantIds, "front"),
    "front"
  ) || { width: 1800, height: 2400 }

  const frontPosition = isHoodie
    ? buildPrintPositionFromPrintfiles(
        printfilesRaw.printfiles || [],
        printfilesRaw.variant_printfiles,
        variantIds,
        "front",
        "apparel"
      )
    : buildCentredFrontPosition(frontDims.width, frontDims.height, false)

  const metaSource = readDesignSourceFromMetadata(product.metadata)
  const designUrl = await resolveDurablePrintfulDesignUrl(client, syncVariants, {
    log,
    fallbackUrls: (product.images || []).map((i) => i.url).filter(Boolean) as string[],
  })
  if (!designUrl) {
    throw new Error("Could not resolve durable Printful design URL for mockups")
  }

  const artwork = await resolveArtworkUrlForMockup(
    client,
    designUrl,
    metaSource.fileId,
    log
  )

  const shots: OutkastGalleryShot[] = []
  const slots = outkastGallerySlotsFromPlan(plan)
  if (!slots.length) {
    throw new Error("No Outkast gallery mockup groups matched Printful option_groups")
  }

  let blankBackUrl: string | undefined
  const backPosition = buildPrintPositionFromPrintfiles(
    printfilesRaw.printfiles || [],
    printfilesRaw.variant_printfiles,
    variantIds,
    "back",
    "apparel"
  )

  const gapMs = Number(process.env.PRINTFUL_MOCKUP_TASK_DELAY_MS || 3000)

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    const placement = slot.slot === "back" ? "back" : "front"
    const category = categoryForSlot(slot.slot, slot.optionGroup)

    for (const cv of colorVariants) {
      const baseShot: OutkastGalleryShot = {
        role: slot.slot,
        status: "failed",
        optionGroup: slot.optionGroup,
        category,
        placement,
        color: cv.color,
        variantId: cv.variantId,
      }

      try {
        if (i > 0 || colorVariants.indexOf(cv) > 0) {
          await throttlePrintfulMockupCreateTask()
        }

        let imageUrl = artwork.url
        let position = frontPosition
        if (slot.slot === "back") {
          if (!blankBackUrl) {
            blankBackUrl = await blankPrintFileUrl(
              client,
              frontDims.width,
              frontDims.height,
              log
            )
          }
          imageUrl = blankBackUrl
          position = backPosition
        }

        const filePayload = buildApparelMockupFilePayload({
          placement,
          designSourceUrl: imageUrl,
          printPosition: position,
          artworkWidth: artwork.width,
          artworkHeight: artwork.height,
        })

        const request: MockupCreateTaskRequest = {
          variant_ids: [cv.variantId],
          format: "png",
          files: [
            {
              placement: filePayload.placement,
              image_url: filePayload.image_url,
              position: filePayload.position,
            },
          ],
          option_groups: [slot.optionGroup],
          options: mockupCreateOptionsForPlacement(placement),
        }

        log(
          `Mockup ${slot.slot} group=${slot.optionGroup} placement=${placement} variant=${cv.variantId} color=${cv.color}`
        )

        const taskLog = await withPrintfulRetries(
          `Outkast mockup ${slot.optionGroup}`,
          log,
          () =>
            runPrintfulMockupTask(client, catalogProductId, request, {
              optionGroupLabel: slot.optionGroup,
              log,
            }),
          4,
          gapMs
        )

        const poll = taskLog.pollResponse
        if (!poll) {
          shots.push({ ...baseShot, error: "Mockup task missing poll response" })
          continue
        }

        const picked = pickBestCandidateUrl(poll, slot.optionGroup, placement, cv.variantId)
        if (!picked) {
          shots.push({ ...baseShot, error: "No mockup URL in Printful response" })
          continue
        }

        let durableUrl: string | undefined
        if (persistDurable && !dryRun) {
          durableUrl = await ensureDurablePublicImageUrl(picked.url, log, client)
        }

        shots.push({
          ...baseShot,
          status: "ok",
          option: picked.option,
          view: picked.view,
          mockupUrl: picked.url,
          durableUrl,
        })
      } catch (e: unknown) {
        const msg = formatErrorMessage(e)
        log(`Shot failed ${slot.slot}/${cv.color}: ${msg}`)
        shots.push({ ...baseShot, error: msg })
      }
    }
  }

  const galleryUrls = shots
    .filter((s) => s.status === "ok")
    .map((s) => s.durableUrl || s.mockupUrl)
    .filter(Boolean) as string[]

  let appliedToProduct = false
  if (applyToProduct && !dryRun && galleryUrls.length) {
    await applyApparelProductGallery(container, {
      productId: product.id,
      imageUrls: galleryUrls,
    })
    appliedToProduct = true
    log(`Applied ${galleryUrls.length} image(s) to Medusa product ${handle}`)
  }

  return {
    handle,
    productId: product.id,
    catalogProductId,
    printfulProductId,
    dryRun,
    persistDurable,
    appliedToProduct,
    styles,
    plan,
    shots,
    galleryUrls,
    logs,
  }
}

function categoryForSlot(
  slot: OutkastGalleryShot["role"],
  optionGroup: string
): MockupStyleCategory {
  if (slot === "ghost-front") return "ghost"
  if (slot === "zoomed-in") return "closeup"
  if (slot === "back") return "back"
  if (slot === "product-details") return "detail"
  if (/ghost/i.test(optionGroup)) return "ghost"
  if (/flat/i.test(optionGroup)) return "flat"
  return "other"
}
