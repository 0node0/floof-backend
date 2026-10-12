/**
 * Design PNG → Printful sync product (+ mockups) → Medusa published product.
 *
 * Pipeline:
 *  1. Register design in Printful file library (public URL)
 *  2. Resolve catalog blank (default: Bella+Canvas 3001 tee #71)
 *  3. Create Printful sync product with front print on selected variants
 *  4. Re-fetch product (create response often omits sync_variants)
 *  5. Generate product + lifestyle mockups (async task, polled)
 *  6. Create Medusa product with mockup/preview images + PF-{sync_variant_id} SKUs
 */

import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createProductsWorkflow,
  updateProductsWorkflow,
} from "@medusajs/medusa/core-flows"
import PrintfulApiClient from "../modules/printful/client"
import {
  ensureStyleCollection,
  linkProductToStyleCollection,
} from "./style-collections"
import {
  buildDrinkwareLifestyleGallery,
  buildMugProductGallery,
  isMugCatalogProductId,
  loadPrintfulMockupConfig,
  resolveDrinkwareLifestyleOptionGroups,
  stripFloofProductTitle,
  type MockupProductKind,
} from "./printful-mockup-config"
import {
  isEphemeralFloofDesignUrl,
  resolveDurablePrintfulDesignUrl,
} from "./printful-design-url"
import { sleep as delay } from "./async-sleep"
import {
  runPrintfulMockupTask,
  type MockupTaskRunLog,
} from "./printful-mockup-generator"
import {
  isStockCatalogImageUrl,
  newLifestyleMockupUrlsAdded,
  replaceProductGalleryImages,
} from "./medusa-product-images"

function drinkwareBatchesFallback() {
  return resolveDrinkwareLifestyleOptionGroups(["Lifestyle", "Lifestyle 2", "Lifestyle 3"]).map(
    (g) => ({
      optionGroups: [g],
      gender: "neutral" as const,
    })
  )
}

export type GarmentKind = "tee" | "hoodie"

export type CreateFromDesignInput = {
  name: string
  description?: string
  designUrl: string
  garment?: GarmentKind
  catalogProductId?: number
  colors?: string[]
  sizes?: string[]
  retailPrice?: string
  category?: "tees" | "hoodies" | "hats" | "accessories"
  generateMockups?: boolean
  mockupOptionGroups?: string[]
  phrase?: string
  /** Style collection handle (e.g. retro, minimal) */
  style?: string
  /** When true, Medusa product is created as draft (unpublished) */
  draft?: boolean
}

export type MockupShot = {
  url: string
  kind: "product" | "lifestyle" | "other"
  gender: "male" | "female" | "neutral"
  title?: string
}

export type CreateFromDesignResult = {
  printful: {
    syncProductId: number
    externalId: string
    thumbnailUrl?: string
    variantCount: number
  }
  mockups: MockupShot[]
  gallery: string[]
  medusa: {
    productId: string
    handle: string
    title: string
  } | null
  mockupTasks?: MockupTaskRunLog[]
  imagesChanged?: boolean
  logs: string[]
}

const DEFAULT_CATALOG: Record<GarmentKind, number> = {
  tee: 71, // Bella + Canvas 3001
  hoodie: 146, // Gildan 18500
}

const DEFAULT_COLORS = ["Black", "White"]
const DEFAULT_SIZES = ["S", "M", "L", "XL", "2XL"]

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function classifyMockup(title: string | undefined, extra?: string): "product" | "lifestyle" | "other" {
  const t = `${title || ""} ${extra || ""}`.toLowerCase()
  if (t.includes("lifestyle") || t.includes("model") || t.includes("wearing") || t.includes("couple")) {
    return "lifestyle"
  }
  if (
    t.includes("flat") ||
    t.includes("ghost") ||
    t.includes("hanger") ||
    t.includes("product") ||
    t.includes("folded")
  ) {
    return "product"
  }
  if (/\bmen\b|\bwomen\b|\bmale\b|\bfemale\b/.test(t)) return "lifestyle"
  return "other"
}

function classifyGender(title: string | undefined): "male" | "female" | "neutral" {
  const t = (title || "").toLowerCase()
  // women before men (men is substring of women)
  if (t.includes("women") || t.includes("woman") || t.includes("female") || t.includes("ladies")) {
    return "female"
  }
  if (t.includes("men's") || t.includes("mens") || /\bmen\b|\bman\b|\bmale\b|\bguy\b/.test(t)) {
    return "male"
  }
  return "neutral"
}

/**
 * Gallery: main = first male|female lifestyle, then up to 3 male + 3 female.
 */
export function buildLifestyleGallery(shots: MockupShot[], extras: string[] = []): string[] {
  // Prefer front-facing lifestyle shots when available
  const frontFirst = (list: MockupShot[]) =>
    [...list].sort((a, b) => {
      const sf = (t?: string) => (/front/i.test(t || "") ? 0 : /back/i.test(t || "") ? 2 : 1)
      return sf(a.title) - sf(b.title)
    })

  const male = frontFirst(shots.filter((s) => s.gender === "male"))
  const female = frontFirst(shots.filter((s) => s.gender === "female"))
  const main = male[0] || female[0] || shots[0]
  const urls: string[] = []
  const push = (u?: string) => {
    if (u && !urls.includes(u) && !u.includes("/floof/design-files/")) urls.push(u)
  }
  if (main) push(main.url)
  // Main is 1 model shot; then 3 more male + 3 more female lifestyle
  for (const s of male.filter((x) => x.url !== main?.url).slice(0, 3)) push(s.url)
  for (const s of female.filter((x) => x.url !== main?.url).slice(0, 3)) push(s.url)
  if (urls.length < 7) {
    for (const s of shots) {
      if (urls.length >= 7) break
      push(s.url)
    }
  }
  for (const u of extras) {
    if (urls.length >= 7) break
    push(u)
  }
  return urls
}

async function permanizeMockupUrl(
  client: PrintfulApiClient,
  url: string,
  log: (m: string) => void
): Promise<string> {
  if (url.includes("files.cdn.printful.com/files/")) return url
  try {
    const f = await client.post<any>("/files", { url, filename: `mockup-${Date.now()}.jpg` })
    for (let i = 0; i < 15; i++) {
      const polled = await client.get<any>(`/files/${f.id}`)
      if (polled.status === "ok" || polled.status === "ready") {
        return polled.preview_url || polled.thumbnail_url || polled.url || url
      }
      if (polled.status === "failed" || polled.status === "error") break
      await sleep(1000)
    }
  } catch (e: any) {
    log(`Could not permanize mockup (${e.message}) — keeping original`)
  }
  return url
}

async function runMockupTask(
  client: PrintfulApiClient,
  catalogProductId: number,
  variantIds: number[],
  designUrl: string,
  placement: string,
  position: Record<string, number>,
  optionGroups: string[],
  log: (m: string) => void,
  genderHint: "male" | "female" | "neutral" = "neutral"
): Promise<{ shots: MockupShot[]; taskLog?: MockupTaskRunLog }> {
  const shots: MockupShot[] = []
  const group = optionGroups[0]
  if (!group) return { shots }

  const taskLog = await runPrintfulMockupTask(
    client,
    catalogProductId,
    {
      variant_ids: variantIds,
      format: "jpg",
      files: [{ placement, image_url: designUrl, position }],
      option_groups: [group],
    },
    { log, optionGroupLabel: group, sleep: (ms) => sleep(ms).then(() => undefined) }
  )

  for (const url of taskLog.mockupUrls) {
    const title = `${group} · mockup`
    shots.push({
      url,
      kind: /lifestyle/i.test(group) ? "lifestyle" : classifyMockup(title),
      gender: genderHint !== "neutral" ? genderHint : classifyGender(title),
      title,
    })
  }

  return { shots, taskLog }
}

/** Generate male + female lifestyle mockups; return curated 7-image gallery. */
export async function generateLifestyleMockups(opts: {
  client: PrintfulApiClient
  catalogProductId: number
  variantIds: number[]
  designUrl: string
  optionGroups?: string[]
  log: (m: string) => void
}): Promise<{ shots: MockupShot[]; gallery: string[]; mockupTasks: MockupTaskRunLog[] }> {
  const { client, catalogProductId, variantIds, designUrl, log } = opts
  let placement = "front"
  let productKind: MockupProductKind = "apparel"
  let position: Record<string, number> = {
    area_width: 1800,
    area_height: 2400,
    width: 1800,
    height: 1800,
    top: 300,
    left: 0,
  }
  let batches: Array<{ optionGroups: string[]; gender: "male" | "female" | "neutral" }> = []

  try {
    const mockupConfig = await loadPrintfulMockupConfig(
      client,
      catalogProductId,
      variantIds,
      opts.optionGroups
    )
    placement = mockupConfig.placement
    position = mockupConfig.position
    productKind = mockupConfig.productKind
    batches = mockupConfig.batches
    log(
      `Mockup kind=${productKind} placement=${placement}; position=${JSON.stringify(position)}`
    )
    log(
      `Mockup groups available: ${mockupConfig.optionGroupsAvailable
        .filter((g) => /lifestyle|men|women|flat/i.test(g))
        .join(", ")}`
    )
    log(
      `Mockup batches: ${batches
        .map((b) => `${b.gender}=[${b.optionGroups.join(", ")}]`)
        .join("; ")}`
    )
  } catch (e: any) {
    log(`printfiles load failed: ${e.message}`)
    if (isMugCatalogProductId(catalogProductId)) {
      productKind = "drinkware"
      placement = "default"
      log("Treating as drinkware after printfiles failure (mug catalog id)")
    }
  }

  if (!batches.length && productKind !== "drinkware") {
    batches = [
      {
        optionGroups: ["Men's Lifestyle", "Men's Lifestyle 2", "Men's Lifestyle 3"],
        gender: "male",
      },
      {
        optionGroups: ["Women's Lifestyle", "Women's Lifestyle 2", "Women's Lifestyle 3"],
        gender: "female",
      },
    ]
    log("Using fallback apparel lifestyle mockup groups")
  } else if (!batches.length && productKind === "drinkware") {
    batches = drinkwareBatchesFallback()
    log(`Using fallback drinkware lifestyle groups: ${batches.map((b) => b.optionGroups[0]).join(", ")}`)
  }

  const vids = variantIds.slice(0, 2)
  let shots: MockupShot[] = []
  const mockupTasks: MockupTaskRunLog[] = []
  const taskGapMs = Number(process.env.PRINTFUL_MOCKUP_TASK_DELAY_MS || 2500)
  let taskIndex = 0

  for (const batch of batches) {
    for (const group of batch.optionGroups.filter(Boolean)) {
      if (taskIndex > 0) {
        await delay(taskGapMs)
      }
      taskIndex++
      try {
        const { shots: batchShots, taskLog } = await runMockupTask(
          client,
          catalogProductId,
          vids,
          designUrl,
          placement,
          position,
          [group],
          log,
          batch.gender
        )
        shots = shots.concat(batchShots)
        if (taskLog) mockupTasks.push(taskLog)
      } catch (e: any) {
        log(`Mockup task failed (${group}): ${e.message}`)
      }
    }
  }

  const seen = new Set<string>()
  shots = shots.filter((s) => {
    if (seen.has(s.url)) return false
    seen.add(s.url)
    return true
  })
  log(
    `Raw mockups: ${shots.length} (♂${shots.filter((s) => s.gender === "male").length} ♀${shots.filter((s) => s.gender === "female").length})`
  )

  const permanized: MockupShot[] = []
  for (const s of shots) {
    permanized.push({ ...s, url: await permanizeMockupUrl(client, s.url, log) })
  }
  const gallery =
    productKind === "drinkware"
      ? buildDrinkwareLifestyleGallery(permanized)
      : buildLifestyleGallery(permanized)
  log(`Gallery ready (${gallery.length} images)`)
  return { shots: permanized, gallery, mockupTasks }
}

/** Exact color match (case-insensitive), with light aliases */
function colorMatches(variantColor: string, wanted: string[]): boolean {
  const c = variantColor.toLowerCase().trim()
  return wanted.some((w) => {
    const want = w.toLowerCase().trim()
    if (c === want) return true
    // "Solid White" / "Soft White" when user asked White
    if (want === "white" && (c === "white" || c.endsWith(" white") || c.startsWith("white ")))
      return true
    if (want === "black" && (c === "black" || c.endsWith(" black") || c.startsWith("black ")))
      return true
    return false
  })
}

function makeClient(): PrintfulApiClient {
  const token = process.env.PRINTFUL_API_TOKEN || process.env.PRINTFUL_API_KEY || ""
  if (!token) throw new Error("PRINTFUL_API_TOKEN is not set")
  return new PrintfulApiClient(token, process.env.PRINTFUL_STORE_ID)
}

function collectPreviewUrls(syncVariants: any[]): string[] {
  const urls: string[] = []
  for (const sv of syncVariants) {
    for (const f of sv.files || []) {
      const u = f.preview_url || f.thumbnail_url || f.url
      if (u && !urls.includes(u)) urls.push(u)
    }
    const productImg = sv.product?.image
    if (productImg && !urls.includes(productImg)) urls.push(productImg)
  }
  return urls
}

/** Print file previews (flat art), excluding catalog stock photos. */
function collectFlatArtUrls(syncVariants: any[]): string[] {
  return collectPreviewUrls(syncVariants).filter((u) => !isStockCatalogImageUrl(u))
}

/**
 * Import an existing Printful sync product into Medusa.
 * When regenerateMockups=true, generates ♂/♀ lifestyle shots and updates images
 * on an existing Medusa product (matched by printful_product_id metadata) or creates one.
 */
export async function importPrintfulProductToMedusa(
  printfulProductId: number,
  container: MedusaContainer,
  opts?: {
    phrase?: string
    category?: string
    description?: string
    regenerateMockups?: boolean
    catalogProductId?: number
  }
): Promise<CreateFromDesignResult> {
  const logs: string[] = []
  const log = (m: string) => {
    logs.push(m)
    console.log(`[design→product] ${m}`)
  }

  const client = makeClient()
  log(`Importing Printful product ${printfulProductId}`)
  const detail = await client.get<any>(`/store/products/${printfulProductId}`)
  const syncProduct = detail.sync_product || detail
  const syncVariants: any[] = detail.sync_variants || []
  if (!syncVariants.length) {
    throw new Error(`Printful product ${printfulProductId} has no sync variants`)
  }

  const title = stripFloofProductTitle(syncProduct.name || `Printful ${printfulProductId}`)
  const phrase =
    opts?.phrase ||
    title
      .replace(/^FLOOF\s*[-–—]\s*/i, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .join(" ")
  const lower = title.toLowerCase()
  const category =
    opts?.category ||
    (lower.includes("hoodie") || lower.includes("sweat") ? "hoodies" : "tees")

  const previewUrls = collectPreviewUrls(syncVariants)
  const flatArtUrls = collectFlatArtUrls(syncVariants)
  let mockups: MockupShot[] = []
  let gallery: string[] = []
  let mockupTasks: MockupTaskRunLog[] = []
  let imagesChanged = false

  const catalogProductId =
    opts?.catalogProductId ||
    syncVariants[0]?.product?.product_id ||
    (category === "hoodies" ? 146 : 71)

  const designUrl = await resolveDurablePrintfulDesignUrl(client, syncVariants, {
    thumbnailUrl: syncProduct.thumbnail_url,
    fallbackUrls: flatArtUrls.length ? flatArtUrls : previewUrls,
    log,
  })

  let mockupProductKind: MockupProductKind = "other"
  if (opts?.regenerateMockups) {
    if (!designUrl) {
      log("No durable Printful design URL — cannot run mockup tasks")
    } else if (isEphemeralFloofDesignUrl(designUrl)) {
      log(`Refusing ephemeral design URL for mockups: ${designUrl}`)
    }
  }

  if (opts?.regenerateMockups && designUrl && !isEphemeralFloofDesignUrl(designUrl)) {
    try {
      const variantIds = syncVariants
        .map((v: any) => v.variant_id)
        .filter(Boolean)
        .slice(0, 4)
      const mockupConfig = await loadPrintfulMockupConfig(
        client,
        Number(catalogProductId),
        variantIds
      )
      mockupProductKind = mockupConfig.productKind

      const result = await generateLifestyleMockups({
        client,
        catalogProductId: Number(catalogProductId),
        variantIds,
        designUrl,
        log,
      })
      mockups = result.shots
      mockupTasks = result.mockupTasks

      if (mockupProductKind === "drinkware") {
        gallery = buildMugProductGallery(
          mockups,
          flatArtUrls,
          previewUrls.filter((u) => isStockCatalogImageUrl(u))
        )
      } else {
        gallery = result.gallery
      }
      log(`Regenerated gallery (${gallery.length} urls): ${gallery.join(" | ")}`)
    } catch (e: any) {
      log(`Regenerate mockups failed: ${e.message}`)
    }
  }

  if (!gallery.length) {
    gallery = buildLifestyleGallery(mockups, flatArtUrls.length ? flatArtUrls : previewUrls)
  }
  if (!gallery.length) {
    gallery = flatArtUrls.slice(0, 7)
  }

  const thumbnailUrl = gallery[0] || previewUrls[0] || syncProduct.thumbnail_url
  const images = gallery.length ? gallery : thumbnailUrl ? [thumbnailUrl] : []

  // Prefer updating existing Medusa product (by printful id, handle, or SKU)
  const productModule = container.resolve(Modules.PRODUCT)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const wantHandle = slugify(title)
  const sampleSku = syncVariants[0] ? `PF-${syncVariants[0].id}` : null

  let existingProduct: { id: string; handle: string; title: string } | null = null
  try {
    const { data: prods } = await query.graph({
      entity: "product",
      fields: ["id", "handle", "title", "metadata", "variants.sku"],
    })
    const match = (prods || []).find((p: any) => {
      const mid = p.metadata?.printful_product_id
      if (mid == printfulProductId || mid === String(printfulProductId)) return true
      if (p.handle === wantHandle) return true
      if (sampleSku && (p.variants || []).some((v: any) => v.sku === sampleSku)) return true
      return false
    })
    if (match) {
      existingProduct = { id: match.id, handle: match.handle, title: match.title }
      log(`Found existing Medusa product ${match.handle} (${match.id})`)
    }
  } catch (e: any) {
    log(`Product lookup via query failed: ${e.message}`)
    const byHandle = await productModule.listProducts({ handle: wantHandle }, { take: 1 })
    if (byHandle[0]) {
      existingProduct = {
        id: byHandle[0].id,
        handle: byHandle[0].handle,
        title: byHandle[0].title,
      }
    }
  }

  let medusa: CreateFromDesignResult["medusa"] = null

  if (existingProduct && images.length) {
    log(
      `Replacing Medusa product ${existingProduct.id} (${existingProduct.handle}) gallery (${images.length} images)`
    )
    const cleanedTitle = stripFloofProductTitle(existingProduct.title)
    try {
      const replaced = await replaceProductGalleryImages(
        container,
        existingProduct.id,
        images,
        images[0]
      )
      const lifestyleUrls = mockups
        .filter((s) => s.kind === "lifestyle")
        .map((s) => s.url)
      imagesChanged = newLifestyleMockupUrlsAdded(
        replaced.previousUrls,
        replaced.nextUrls,
        lifestyleUrls
      )
      log(
        `Gallery replace lifestyleAdded=${imagesChanged} urlsChanged=${replaced.imagesChanged} thumbnailChanged=${replaced.thumbnailChanged}`
      )

      await updateProductsWorkflow(container).run({
        input: {
          products: [
            {
              id: existingProduct.id,
              title: cleanedTitle,
              metadata: {
                printful_product_id: printfulProductId,
                printful_catalog_product_id: catalogProductId,
                category,
                phrase,
                design_pipeline: "product-from-design",
              },
            },
          ],
        } as any,
      })
      medusa = {
        productId: existingProduct.id,
        handle: existingProduct.handle,
        title: cleanedTitle,
      }
      log(`Updated product ${existingProduct.handle}`)
    } catch (e: any) {
      log(`Medusa gallery replace failed: ${e.message}`)
      throw new Error(
        `Found product ${existingProduct.handle} but could not update images: ${e.message}`
      )
    }
  }

  if (!medusa) {
    medusa = await createMedusaProduct(container, {
      title,
      description:
        opts?.description ||
        `${title} — printed on demand by Floof × Printful. Soft blanks, sharp wit.`,
      phrase,
      category,
      thumbnailUrl: images[0] || thumbnailUrl,
      images: images.length ? images : thumbnailUrl ? [thumbnailUrl] : [],
      syncVariants,
      retailPrice: syncVariants[0]?.retail_price || "28.00",
      printfulProductId,
      log,
    })
  }

  return {
    printful: {
      syncProductId: printfulProductId,
      externalId: syncProduct.external_id || "",
      thumbnailUrl: images[0] || thumbnailUrl,
      variantCount: syncVariants.length,
    },
    mockups,
    gallery: images,
    medusa,
    mockupTasks,
    imagesChanged,
    logs,
  }
}

/**
 * Full design → Printful → Medusa pipeline.
 */
export async function createProductFromDesign(
  input: CreateFromDesignInput,
  container?: MedusaContainer
): Promise<CreateFromDesignResult> {
  const logs: string[] = []
  const log = (m: string) => {
    logs.push(m)
    console.log(`[design→product] ${m}`)
  }

  if (!input.name?.trim()) throw new Error("name is required")
  if (!input.designUrl?.trim()) throw new Error("designUrl is required (public HTTPS URL to PNG)")
  if (!/^https?:\/\//i.test(input.designUrl)) {
    throw new Error("designUrl must be a public http(s) URL — Printful cannot fetch local files")
  }

  const client = makeClient()
  const garment: GarmentKind = input.garment || "tee"
  const catalogProductId = input.catalogProductId || DEFAULT_CATALOG[garment]
  const colors = (input.colors?.length ? input.colors : DEFAULT_COLORS).map((c) =>
    c.toLowerCase()
  )
  const sizes = (input.sizes?.length ? input.sizes : DEFAULT_SIZES).map((s) =>
    s.toUpperCase()
  )
  const retailPrice = input.retailPrice || (garment === "hoodie" ? "48.00" : "28.00")
  const generateMockups = input.generateMockups !== false
  const category = input.category || (garment === "hoodie" ? "hoodies" : "tees")
  const phrase =
    input.phrase ||
    stripFloofProductTitle(input.name)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .join(" ")

  // ── 1. Register design file ──────────────────────────────────
  log(`Registering design file: ${input.designUrl}`)
  const file = await client.post<any>("/files", {
    url: input.designUrl,
    filename: `${slugify(input.name)}.png`,
  })
  const fileId = file.id as number
  let fileUrl = file.url || input.designUrl
  log(`File id=${fileId} status=${file.status || "ok"}`)

  // Wait for file processing
  for (let i = 0; i < 30; i++) {
    const f = await client.get<any>(`/files/${fileId}`)
    log(`File poll status=${f.status}`)
    if (f.status === "ok" || f.status === "ready") {
      fileUrl = f.url || fileUrl
      break
    }
    if (f.status === "failed" || f.status === "error") {
      throw new Error(`Printful file processing failed: ${f.status}`)
    }
    await sleep(1500)
  }

  // ── 2. Catalog variants ──────────────────────────────────────
  log(`Loading catalog product #${catalogProductId}`)
  const catalog = await client.get<any>(`/products/${catalogProductId}`)
  const catalogVariants: any[] = catalog.variants || []
  if (!catalogVariants.length) {
    throw new Error(`No variants on catalog product ${catalogProductId}`)
  }

  const selected = catalogVariants.filter((v) => {
    const color = String(v.color || "")
    const size = String(v.size || "").toUpperCase()
    return v.in_stock !== false && colorMatches(color, colors) && sizes.includes(size)
  })

  if (!selected.length) {
    const sample = catalogVariants
      .slice(0, 12)
      .map((v) => `${v.color}/${v.size}`)
      .join(", ")
    throw new Error(
      `No catalog variants matched colors=[${colors.join(",")}] sizes=[${sizes.join(",")}]. Sample: ${sample}`
    )
  }

  // Keep under Printful's 100-variant cap; prefer a manageable set
  const variants = selected.slice(0, 40)
  log(
    `Selected ${variants.length} catalog variants (from ${selected.length} matches): ${[
      ...new Set(variants.map((v) => v.color)),
    ].join(", ")} × ${[...new Set(variants.map((v) => v.size))].join(", ")}`
  )

  // ── 3. Create Printful sync product ──────────────────────────
  const externalId = `floof_${Date.now()}_${slugify(input.name).slice(0, 40)}`
  const title = stripFloofProductTitle(input.name.trim())

  const mockupConfig = await loadPrintfulMockupConfig(
    client,
    catalogProductId,
    variants.map((v) => v.id)
  )
  log(
    `Print placement=${mockupConfig.placement} sync_file_type=${mockupConfig.syncFileType}`
  )

  const printFile = { type: mockupConfig.syncFileType, id: fileId }

  const syncPayload = {
    sync_product: {
      name: title,
      thumbnail: fileUrl,
      external_id: externalId,
    },
    sync_variants: variants.map((v) => ({
      external_id: `${externalId}_${v.id}`,
      variant_id: v.id,
      retail_price: retailPrice,
      files: [printFile],
    })),
  }

  log(`Creating Printful sync product "${title}" with ${syncPayload.sync_variants.length} variants…`)
  const created = await client.post<any>("/store/products", syncPayload)
  let syncProduct = created.sync_product || created
  let syncVariants: any[] = created.sync_variants || []
  const syncProductId = Number(syncProduct.id)
  log(
    `Create response: id=${syncProductId} variants_in_response=${syncVariants.length} product.variants_field=${syncProduct.variants ?? "?"}`
  )

  // Create response often omits sync_variants — always re-fetch detail
  if (!syncVariants.length && syncProductId) {
    log(`Re-fetching /store/products/${syncProductId} for sync_variants…`)
    for (let attempt = 0; attempt < 5; attempt++) {
      await sleep(1000 + attempt * 500)
      const detail = await client.get<any>(`/store/products/${syncProductId}`)
      syncProduct = detail.sync_product || detail
      syncVariants = detail.sync_variants || []
      log(`Re-fetch attempt ${attempt + 1}: sync_variants=${syncVariants.length}`)
      if (syncVariants.length) break
    }
  }

  if (!syncVariants.length) {
    throw new Error(
      `Printful product ${syncProductId} has no sync variants after create+refetch. Check Printful dashboard.`
    )
  }
  log(`Printful sync product id=${syncProductId} variants=${syncVariants.length}`)

  // ── 4. Lifestyle mockups (♂ + ♀) ─────────────────────────────
  let mockups: MockupShot[] = []
  let gallery: string[] = []
  const previewUrls = collectPreviewUrls(syncVariants)

  // Prefer a design URL Printful can re-fetch: file CDN or original
  const designForMockups =
    (fileUrl && !fileUrl.includes("/floof/design-files/") ? fileUrl : null) ||
    input.designUrl

  if (generateMockups) {
    try {
      const result = await generateLifestyleMockups({
        client,
        catalogProductId,
        variantIds: variants.map((v) => v.id),
        designUrl: designForMockups,
        optionGroups: input.mockupOptionGroups,
        log,
      })
      mockups = result.shots
      gallery = result.gallery
    } catch (e: any) {
      log(`Mockup generation skipped/failed: ${e.message}`)
    }
  }

  if (!gallery.length) {
    gallery = buildLifestyleGallery(mockups, previewUrls)
  }
  if (!gallery.length && previewUrls[0]) gallery = previewUrls.slice(0, 7)

  const thumbnailUrl = gallery[0] || syncProduct.thumbnail_url || fileUrl
  const images = gallery.length
    ? gallery
    : [thumbnailUrl].filter(Boolean)

  // ── 5. Medusa product ────────────────────────────────────────
  let medusa: CreateFromDesignResult["medusa"] = null

  if (container) {
    try {
      medusa = await createMedusaProduct(container, {
        title,
        description:
          input.description ||
          `${title} — printed on demand by Floof × Printful. Soft blanks, sharp wit.`,
        phrase,
        category,
        thumbnailUrl: images[0] || thumbnailUrl,
        images: images.length ? images : [thumbnailUrl],
        syncVariants,
        retailPrice,
        printfulProductId: syncProductId,
        status: input.draft ? "draft" : "published",
        styleHandle: input.style,
        log,
      })
    } catch (e: any) {
      log(`Medusa create failed: ${e.message}`)
      throw e
    }
  } else {
    log("No Medusa container — Printful only")
  }

  return {
    printful: {
      syncProductId,
      externalId,
      thumbnailUrl: images[0] || thumbnailUrl,
      variantCount: syncVariants.length,
    },
    mockups,
    gallery: images,
    medusa,
    logs,
  }
}

async function createMedusaProduct(
  container: MedusaContainer,
  opts: {
    title: string
    description: string
    phrase: string
    category: string
    thumbnailUrl: string
    images: string[]
    syncVariants: any[]
    retailPrice: string
    printfulProductId: number
    status?: "draft" | "published"
    styleHandle?: string
    log: (m: string) => void
  }
) {
  const productModule = container.resolve(Modules.PRODUCT)
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL)

  let channel = (
    await salesChannelModule.listSalesChannels({ name: "Default Sales Channel" })
  )[0]
  if (!channel) {
    const channels = await salesChannelModule.listSalesChannels({}, { take: 1 })
    channel = channels[0]
  }
  if (!channel) throw new Error("No sales channel — run seed first")

  let handle = slugify(opts.title)
  const existing = await productModule.listProducts({ handle }, { take: 1 })
  if (existing.length) {
    handle = `${handle}-${Date.now().toString(36)}`
  }

  const sizeSet = new Set<string>()
  const colorSet = new Set<string>()

  const medusaVariants = opts.syncVariants.map((sv: any) => {
    // Name format from Printful: "FLOOF — Title / Black / 2XL"
    const nameParts = String(sv.name || "")
      .split("/")
      .map((s: string) => s.trim())
    let size = "One Size"
    let color = "Default"
    if (nameParts.length >= 3) {
      color = nameParts[nameParts.length - 2]
      size = nameParts[nameParts.length - 1]
    } else if (nameParts.length === 2) {
      color = nameParts[0]
      size = nameParts[1]
    } else if (sv.product?.name) {
      // "Bella + Canvas … (Black / 2XL)"
      const m = String(sv.product.name).match(/\(([^/]+)\/([^)]+)\)/)
      if (m) {
        color = m[1].trim()
        size = m[2].trim()
      }
    }

    size = String(size).toUpperCase()
    color = String(color)
    sizeSet.add(size)
    colorSet.add(color)

    const amount = Math.round(parseFloat(sv.retail_price || opts.retailPrice || "0") * 100)

    return {
      title: `${size} / ${color}`,
      sku: `PF-${sv.id}`,
      options: { Size: size, Color: color },
      prices: [{ amount, currency_code: "usd" }],
      manage_inventory: false,
      metadata: {
        printful_sync_variant_id: sv.id,
        printful_catalog_variant_id: sv.variant_id,
        printful_external_id: sv.external_id,
      },
    }
  })

  if (!medusaVariants.length) {
    throw new Error(
      `Printful returned no sync variants for product ${opts.printfulProductId}`
    )
  }

  const productInput: any = {
    title: opts.title,
    handle,
    description: opts.description,
    status: opts.status || "published",
    options: [
      { title: "Size", values: Array.from(sizeSet) },
      { title: "Color", values: Array.from(colorSet) },
    ],
    variants: medusaVariants,
    sales_channels: [{ id: channel.id }],
    metadata: {
      printful_product_id: opts.printfulProductId,
      category: opts.category,
      phrase: opts.phrase,
      design_pipeline: "product-from-design",
    },
    images: opts.images.slice(0, 10).map((url) => ({ url })),
    thumbnail: opts.thumbnailUrl,
  }

  opts.log(
    `Creating Medusa product handle=${handle} variants=${medusaVariants.length} images=${opts.images.length}`
  )
  const { result } = await createProductsWorkflow(container).run({
    input: { products: [productInput] },
  })

  const p = result[0]
  opts.log(`Medusa product created id=${p.id} status=${opts.status || "published"}`)

  if (opts.styleHandle?.trim()) {
    try {
      const collection = await ensureStyleCollection(container, opts.styleHandle)
      await linkProductToStyleCollection(container, collection.id, p.id)
      opts.log(`Linked product to style collection "${collection.handle}"`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      opts.log(`Style collection link failed: ${msg}`)
      throw new Error(`Product created but style collection link failed: ${msg}`)
    }
  }

  return {
    productId: p.id,
    handle: p.handle,
    title: p.title,
  }
}
