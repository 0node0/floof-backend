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
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import PrintfulApiClient from "../modules/printful/client"

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
}

export type CreateFromDesignResult = {
  printful: {
    syncProductId: number
    externalId: string
    thumbnailUrl?: string
    variantCount: number
  }
  mockups: {
    url: string
    kind: "product" | "lifestyle" | "other"
    title?: string
  }[]
  medusa: {
    productId: string
    handle: string
    title: string
  } | null
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
  if (
    t.includes("lifestyle") ||
    t.includes("men") ||
    t.includes("women") ||
    t.includes("model") ||
    t.includes("couple")
  ) {
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
  return "other"
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
      const u = f.preview_url || f.thumbnail_url
      if (u && !urls.includes(u)) urls.push(u)
    }
    const productImg = sv.product?.image
    if (productImg && !urls.includes(productImg)) urls.push(productImg)
  }
  return urls
}

/**
 * Import an existing Printful sync product into Medusa (no redesign).
 * Use after a partial failure where Printful succeeded but Medusa did not.
 */
export async function importPrintfulProductToMedusa(
  printfulProductId: number,
  container: MedusaContainer,
  opts?: { phrase?: string; category?: string; description?: string }
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

  const title = syncProduct.name || `Printful ${printfulProductId}`
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
  const thumbnailUrl =
    previewUrls[0] ||
    syncProduct.thumbnail_url ||
    syncVariants[0]?.files?.find((f: any) => f.type === "preview")?.preview_url

  const images = [thumbnailUrl, ...previewUrls].filter(
    (u, i, arr) => u && arr.indexOf(u) === i && !String(u).includes("/floof/design-files/")
  )

  const medusa = await createMedusaProduct(container, {
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

  return {
    printful: {
      syncProductId: printfulProductId,
      externalId: syncProduct.external_id || "",
      thumbnailUrl: images[0] || thumbnailUrl,
      variantCount: syncVariants.length,
    },
    mockups: previewUrls.map((url) => ({ url, kind: "product" as const })),
    medusa,
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
    input.name
      .replace(/^FLOOF\s*[-–—]\s*/i, "")
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
  const title = input.name.startsWith("FLOOF") ? input.name : `FLOOF — ${input.name}`

  // Prefer Printful file id (already processed) — type "default" is the standard front placement
  const printFile = { type: "default", id: fileId }

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

  // ── 4. Mockups (product + lifestyle) ─────────────────────────
  const mockups: CreateFromDesignResult["mockups"] = []

  if (generateMockups) {
    try {
      const variantIds = variants.slice(0, 4).map((v) => v.id)
      let optionGroups =
        input.mockupOptionGroups || (["Flat", "Men's", "Women's Lifestyle"] as string[])
      let position: Record<string, number> | undefined

      try {
        const printfiles = await client.get<any>(
          `/mockup-generator/printfiles/${catalogProductId}`
        )
        const available: string[] = printfiles.option_groups || []
        if (available.length) {
          log(`Mockup option groups available: ${available.slice(0, 12).join(", ")}…`)
          const preferred = [
            "Flat",
            "Ghost",
            "On Hanger",
            "Men's",
            "Men's Lifestyle",
            "Women's Lifestyle",
          ].filter((g) => available.includes(g))
          if (preferred.length) optionGroups = preferred.slice(0, 4)
          else optionGroups = available.slice(0, 3)
        }

        // Build position from first front printfile so MG-4 is satisfied
        const pfs: any[] = printfiles.printfiles || []
        const front =
          pfs.find((p) => String(p.type || "").includes("front") || p.placement === "front") ||
          pfs[0]
        if (front?.width && front?.height) {
          const areaW = Number(front.width)
          const areaH = Number(front.height)
          // Center a full-width design, ~80% height
          const w = areaW
          const h = Math.round(areaH * 0.8)
          position = {
            area_width: areaW,
            area_height: areaH,
            width: w,
            height: h,
            top: Math.round((areaH - h) / 2),
            left: 0,
          }
          log(`Mockup position from printfile: ${JSON.stringify(position)}`)
        }
      } catch (e: any) {
        log(`Could not load printfiles (using defaults): ${e.message}`)
      }

      // Safe fallback position (Bella 3001-ish print area)
      if (!position) {
        position = {
          area_width: 1800,
          area_height: 2400,
          width: 1800,
          height: 1800,
          top: 300,
          left: 0,
        }
        log(`Using fallback mockup position`)
      }

      log(`Starting mockup task option_groups=[${optionGroups.join(", ")}]`)
      const task = await client.post<any>(
        `/mockup-generator/create-task/${catalogProductId}`,
        {
          variant_ids: variantIds,
          format: "jpg",
          files: [
            {
              placement: "front",
              image_url: input.designUrl,
              position,
            },
          ],
          option_groups: optionGroups,
        }
      )

      const taskKey = task.task_key || task.taskKey
      if (!taskKey) {
        log(`Mockup task missing task_key: ${JSON.stringify(task).slice(0, 200)}`)
      } else {
        log(`Mockup task_key=${taskKey} — polling…`)
        let done = false
        for (let i = 0; i < 40; i++) {
          await sleep(3000)
          const status = await client.get<any>(
            `/mockup-generator/task?task_key=${encodeURIComponent(taskKey)}`
          )
          const st = status.status || status.task_status
          log(`Mockup poll ${i + 1}: ${st}`)
          if (st === "completed" || st === "failed" || st === "error") {
            if (st === "completed") {
              const list: any[] = status.mockups || []
              for (const m of list) {
                const url = m.mockup_url || m.url
                if (url) {
                  mockups.push({
                    url,
                    kind: classifyMockup(m.option || m.title, m.placement),
                    title: m.option || m.title || m.placement,
                  })
                }
                if (Array.isArray(m.extra)) {
                  for (const ex of m.extra) {
                    const u = ex.url || ex.mockup_url
                    if (u) {
                      mockups.push({
                        url: u,
                        kind: classifyMockup(ex.title, ex.option),
                        title: ex.title || ex.option,
                      })
                    }
                  }
                }
              }
              const seen = new Set<string>()
              for (let i = mockups.length - 1; i >= 0; i--) {
                if (seen.has(mockups[i].url)) mockups.splice(i, 1)
                else seen.add(mockups[i].url)
              }
              log(`Collected ${mockups.length} mockup image(s)`)
            } else {
              log(`Mockup generation failed: ${JSON.stringify(status).slice(0, 300)}`)
            }
            done = true
            break
          }
        }
        if (!done) log("Mockup task timed out — continuing with Printful previews")
      }
    } catch (e: any) {
      log(`Mockup generation skipped/failed: ${e.message}`)
    }
  }

  mockups.sort((a, b) => {
    const rank = (k: string) => (k === "product" ? 0 : k === "lifestyle" ? 1 : 2)
    return rank(a.kind) - rank(b.kind)
  })

  // Prefer durable Printful CDN URLs (not our temporary staging URL)
  const previewUrls = collectPreviewUrls(syncVariants)
  const thumbnailUrl =
    mockups.find((m) => m.kind === "product")?.url ||
    mockups[0]?.url ||
    previewUrls[0] ||
    syncProduct.thumbnail_url ||
    fileUrl

  const images = [
    thumbnailUrl,
    ...mockups.map((m) => m.url),
    ...previewUrls,
  ].filter((u, i, arr) => u && arr.indexOf(u) === i && !u.includes("/floof/design-files/"))

  // If everything was staging-only, keep thumbnail as last resort
  if (!images.length && thumbnailUrl) images.push(thumbnailUrl)

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
    status: "published",
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
  opts.log(`Medusa product created id=${p.id}`)

  return {
    productId: p.id,
    handle: p.handle,
    title: p.title,
  }
}
