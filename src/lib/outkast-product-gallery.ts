import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import sharp from "sharp"
import PrintfulApiClient from "../modules/printful/client"
import { buildCentredFrontPosition, detectApparelIsHoodie } from "./apparel-placement-layout"
import { extractMockupCandidatesFromTask } from "./apparel-mockup-candidates"
import { ensureDurablePublicImageUrl } from "./durable-public-image"
import {
  listPrintfulMockupStyles,
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
import { withPrintfulRetries } from "./printful-retry"
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
  role: "front" | "back" | "detail" | "extra"
  optionGroup: string
  category: MockupStyleCategory
  placement: string
  color?: string
  variantId?: number
  option?: string
  view?: string
  mockupUrl: string
  durableUrl?: string
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
  const maxColors = Math.min(12, Math.max(1, input.maxColors ?? 6))

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
  const tasks: Array<{
    role: OutkastGalleryShot["role"]
    optionGroup: string
    placement: string
    category: MockupStyleCategory
    variantIds: number[]
    imageUrl: string
    position: Record<string, number>
  }> = []

  const blankBackUrl = await blankPrintFileUrl(client, frontDims.width, frontDims.height, log)
  const backPosition = buildPrintPositionFromPrintfiles(
    printfilesRaw.printfiles || [],
    printfilesRaw.variant_printfiles,
    variantIds,
    "back",
    "apparel"
  )

  const pushTask = (row: Omit<(typeof tasks)[number], "variantIds">) => {
    tasks.push({ ...row, variantIds })
  }

  if (plan.frontGroup) {
    pushTask({
      role: "front",
      optionGroup: plan.frontGroup,
      placement: "front",
      category: plan.frontGroup.toLowerCase().includes("ghost") ? "ghost" : "flat",
      imageUrl: artwork.url,
      position: frontPosition,
    })
  }
  if (plan.backGroup) {
    pushTask({
      role: "back",
      optionGroup: plan.backGroup,
      placement: "back",
      category: "back",
      imageUrl: blankBackUrl,
      position: backPosition,
    })
  }
  for (const dg of plan.detailGroups.slice(0, 4)) {
    pushTask({
      role: "detail",
      optionGroup: dg,
      placement: "front",
      category: "detail",
      imageUrl: artwork.url,
      position: frontPosition,
    })
  }
  for (const eg of plan.extraGroups.slice(0, 2)) {
    pushTask({
      role: "extra",
      optionGroup: eg,
      placement: "front",
      category: categorizeExtra(eg),
      imageUrl: artwork.url,
      position: frontPosition,
    })
  }

  const gapMs = Number(process.env.PRINTFUL_MOCKUP_TASK_DELAY_MS || 3000)

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]
    if (i > 0) await new Promise((r) => setTimeout(r, gapMs))

    const filePayload = buildApparelMockupFilePayload({
      placement: t.placement,
      designSourceUrl: t.imageUrl,
      printPosition: t.position,
      artworkWidth: artwork.width,
      artworkHeight: artwork.height,
    })

    const request: MockupCreateTaskRequest = {
      variant_ids: t.variantIds,
      format: "png",
      files: [
        {
          placement: filePayload.placement,
          image_url: filePayload.image_url,
          position: filePayload.position,
        },
      ],
      option_groups: [t.optionGroup],
      options: mockupCreateOptionsForPlacement(t.placement),
    }

    log(
      `Mockup ${t.role} group=${t.optionGroup} placement=${t.placement} variants=${JSON.stringify(t.variantIds)}`
    )

    const taskLog = await withPrintfulRetries(
      `Outkast mockup ${t.optionGroup}`,
      log,
      () =>
        runPrintfulMockupTask(client, catalogProductId, request, {
          optionGroupLabel: t.optionGroup,
          log,
        }),
      4,
      gapMs
    )

    const poll = taskLog.pollResponse
    if (!poll) {
      log(`No poll response for ${t.optionGroup}`)
      continue
    }

    for (const cv of colorVariants) {
      const picked = pickBestCandidateUrl(poll, t.optionGroup, t.placement, cv.variantId)
      if (!picked) {
        log(`No mockup URL for ${t.optionGroup} color=${cv.color}`)
        continue
      }

      let durableUrl: string | undefined
      if (persistDurable && !dryRun) {
        durableUrl = await ensureDurablePublicImageUrl(picked.url, log, client)
      }

      shots.push({
        role: t.role,
        optionGroup: t.optionGroup,
        category: t.category,
        placement: t.placement,
        color: cv.color,
        variantId: cv.variantId,
        option: picked.option,
        view: picked.view,
        mockupUrl: picked.url,
        durableUrl,
      })
    }
  }

  const galleryUrls = shots.map((s) => s.durableUrl || s.mockupUrl).filter(Boolean)

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

function categorizeExtra(name: string): MockupStyleCategory {
  const n = name.toLowerCase()
  if (/folded/.test(n)) return "folded"
  if (/hanging/.test(n)) return "hanging"
  return "other"
}
