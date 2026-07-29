/**
 * Design PNG → Printful sync product (+ mockups) → Medusa published product.
 *
 * Pipeline:
 *  1. Register design in Printful file library (public URL)
 *  2. Resolve catalog blank (default: Bella+Canvas 3001 tee #71)
 *  3. Create Printful sync product with front print on selected variants
 *  4. Generate product + lifestyle mockups (async task, polled)
 *  5. Create Medusa product with mockup images + PF-{sync_variant_id} SKUs
 */

import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import PrintfulApiClient from "../modules/printful/client"

export type GarmentKind = "tee" | "hoodie"

export type CreateFromDesignInput = {
  /** Product title on Printful + Medusa */
  name: string
  /** Optional storefront description */
  description?: string
  /** Public HTTPS URL to the design PNG (Printful must be able to fetch it) */
  designUrl: string
  /** Blank garment. Defaults to tee (Bella+Canvas 3001). */
  garment?: GarmentKind
  /** Override Printful catalog product id */
  catalogProductId?: number
  /** Colors to include (case-insensitive match on catalog color). Default: Black, White */
  colors?: string[]
  /** Sizes to include. Default: S–2XL */
  sizes?: string[]
  /** Retail price string, e.g. "28.00". Applied to all variants. */
  retailPrice?: string
  /** Floof category metadata */
  category?: "tees" | "hoodies" | "hats" | "accessories"
  /** Generate Printful mockups (product + lifestyle). Default true */
  generateMockups?: boolean
  /**
   * Mockup option_groups to request from Printful.
   * Defaults include flat/product + lifestyle model styles when available.
   */
  mockupOptionGroups?: string[]
  /** Phrase for storefront cards (defaults to first 3 words of name) */
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
  // Unisex Staple T-Shirt | Bella + Canvas 3001
  tee: 71,
  // Unisex Heavy Blend Hoodie | Gildan 18500
  hoodie: 146,
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
    t.includes("model") ||
    t.includes("lifestyle") ||
    t.includes("men") ||
    t.includes("women") ||
    t.includes("person") ||
    t.includes("wearing")
  ) {
    return "lifestyle"
  }
  if (
    t.includes("flat") ||
    t.includes("ghost") ||
    t.includes("product") ||
    t.includes("front") ||
    t.includes("hanging") ||
    t.includes("on hanger")
  ) {
    return "product"
  }
  return "other"
}

function makeClient(): PrintfulApiClient {
  const token = process.env.PRINTFUL_API_TOKEN || process.env.PRINTFUL_API_KEY || ""
  if (!token) throw new Error("PRINTFUL_API_TOKEN is not set")
  return new PrintfulApiClient(token, process.env.PRINTFUL_STORE_ID)
}

/** Fetch catalog product + variants for a blank */
export async function getCatalogProduct(catalogProductId: number) {
  const client = makeClient()
  return client.get<any>(`/products/${catalogProductId}`)
}

/**
 * Full design → Printful → Medusa pipeline.
 * Pass Medusa `container` to also create the storefront product.
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
  const category =
    input.category || (garment === "hoodie" ? "hoodies" : "tees")
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
  const fileId = file.id
  const fileUrl = file.url || input.designUrl
  log(`File id=${fileId} status=${file.status || "ok"}`)

  // Wait for file processing if needed
  if (file.status && file.status !== "ok" && file.status !== "ready") {
    for (let i = 0; i < 20; i++) {
      await sleep(1500)
      const f = await client.get<any>(`/files/${fileId}`)
      log(`File poll status=${f.status}`)
      if (f.status === "ok" || f.status === "ready") break
      if (f.status === "failed" || f.status === "error") {
        throw new Error(`Printful file processing failed: ${f.status}`)
      }
    }
  }

  // ── 2. Catalog variants ──────────────────────────────────────
  log(`Loading catalog product #${catalogProductId}`)
  const catalog = await client.get<any>(`/products/${catalogProductId}`)
  const catalogVariants: any[] = catalog.variants || []
  if (!catalogVariants.length) {
    throw new Error(`No variants on catalog product ${catalogProductId}`)
  }

  const selected = catalogVariants.filter((v) => {
    const color = String(v.color || "").toLowerCase()
    const size = String(v.size || "").toUpperCase()
    const colorOk = colors.some((c) => color === c || color.includes(c) || c.includes(color))
    const sizeOk = sizes.includes(size)
    return v.in_stock !== false && colorOk && sizeOk
  })

  if (!selected.length) {
    const sample = catalogVariants
      .slice(0, 8)
      .map((v) => `${v.color}/${v.size}`)
      .join(", ")
    throw new Error(
      `No catalog variants matched colors=[${colors.join(",")}] sizes=[${sizes.join(",")}]. Sample: ${sample}`
    )
  }
  // Cap at 100 (Printful limit per sync product)
  const variants = selected.slice(0, 100)
  log(`Selected ${variants.length} catalog variants`)

  // ── 3. Create Printful sync product ──────────────────────────
  const externalId = `floof_${Date.now()}_${slugify(input.name).slice(0, 40)}`
  const title = input.name.startsWith("FLOOF") ? input.name : `FLOOF — ${input.name}`

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
      sku: undefined as string | undefined,
      files: [
        {
          type: "front",
          url: input.designUrl,
          // Prefer file id when available
          ...(fileId ? { id: fileId } : {}),
        },
      ],
    })),
  }

  // Printful accepts either id OR url on files — send url primarily (id can confuse some tokens)
  for (const sv of syncPayload.sync_variants) {
    sv.files = [{ type: "front", url: input.designUrl }]
  }

  log(`Creating Printful sync product "${title}"…`)
  const created = await client.post<any>("/store/products", syncPayload)
  const syncProduct = created.sync_product || created
  const syncVariants = created.sync_variants || []
  const syncProductId = syncProduct.id
  log(`Printful sync product id=${syncProductId} variants=${syncVariants.length}`)

  // ── 4. Mockups (product + lifestyle) ─────────────────────────
  const mockups: CreateFromDesignResult["mockups"] = []

  if (generateMockups) {
    try {
      const variantIds = variants.slice(0, 6).map((v) => v.id)

      // Discover available option groups from printfiles/templates if possible
      let optionGroups =
        input.mockupOptionGroups ||
        (["Flat", "Men's", "Women's", "Lifestyle"] as string[])

      // Prefer groups that exist for this product
      try {
        const printfiles = await client.get<any>(
          `/mockup-generator/printfiles/${catalogProductId}`
        )
        const available: string[] =
          printfiles.option_groups ||
          printfiles.options?.map((o: any) => o.title || o.name) ||
          []
        if (available.length) {
          log(`Mockup option groups available: ${available.join(", ")}`)
          const preferred = available.filter((g: string) => {
            const l = g.toLowerCase()
            return (
              l.includes("flat") ||
              l.includes("ghost") ||
              l.includes("men") ||
              l.includes("women") ||
              l.includes("lifestyle") ||
              l.includes("model") ||
              l.includes("product")
            )
          })
          if (preferred.length) optionGroups = preferred.slice(0, 4)
          else optionGroups = available.slice(0, 3)
        }
      } catch (e: any) {
        log(`Could not load printfiles (using defaults): ${e.message}`)
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
            },
          ],
          option_groups: optionGroups,
        }
      )

      const taskKey = task.task_key || task.taskKey
      if (!taskKey) {
        log(`Mockup task response missing task_key: ${JSON.stringify(task).slice(0, 200)}`)
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
              const list: any[] = status.mockups || status.result || []
              for (const m of list) {
                const url =
                  m.mockup_url ||
                  m.url ||
                  m.extra?.[0]?.url ||
                  m.extra?.[0]?.mockup_url
                if (!url) continue
                // Also pull extras (back, closeups)
                mockups.push({
                  url,
                  kind: classifyMockup(m.option || m.title, m.placement),
                  title: m.option || m.title || m.placement,
                })
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
              // Deduplicate by URL
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
        if (!done) log("Mockup task timed out — continuing without mockups")
      }
    } catch (e: any) {
      log(`Mockup generation skipped/failed: ${e.message}`)
    }
  }

  // Prefer product mockups first, then lifestyle
  mockups.sort((a, b) => {
    const rank = (k: string) => (k === "product" ? 0 : k === "lifestyle" ? 1 : 2)
    return rank(a.kind) - rank(b.kind)
  })

  const thumbnailUrl =
    mockups.find((m) => m.kind === "product")?.url ||
    mockups[0]?.url ||
    syncProduct.thumbnail_url ||
    fileUrl

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
        thumbnailUrl,
        images: [
          thumbnailUrl,
          ...mockups.map((m) => m.url),
        ].filter((u, i, arr) => u && arr.indexOf(u) === i),
        syncVariants,
        retailPrice,
        catalogVariants: variants,
        printfulProductId: syncProductId,
        logs,
        log,
      })
    } catch (e: any) {
      log(`Medusa create failed: ${e.message}`)
      throw e
    }
  } else {
    log("No Medusa container — Printful only (run with medusa exec or API)")
  }

  return {
    printful: {
      syncProductId,
      externalId,
      thumbnailUrl,
      variantCount: syncVariants.length || variants.length,
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
    catalogVariants: any[]
    printfulProductId: number
    logs: string[]
    log: (m: string) => void
  }
) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
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
  // Ensure unique handle
  const existing = await productModule.listProducts({ handle }, { take: 1 })
  if (existing.length) {
    handle = `${handle}-${Date.now().toString(36)}`
  }

  // Map sync variants → Medusa variants
  const sizeSet = new Set<string>()
  const colorSet = new Set<string>()

  const medusaVariants = (opts.syncVariants.length ? opts.syncVariants : []).map(
    (sv: any, idx: number) => {
      // Prefer name like "… / Black / M" or parse from catalog
      const cat = opts.catalogVariants[idx]
      let size = cat?.size || "One Size"
      let color = cat?.color || "Default"

      const nameParts = String(sv.name || "").split("/").map((s: string) => s.trim())
      if (nameParts.length >= 2) {
        // Often "Title / Color / Size" or "Color / Size"
        const last = nameParts[nameParts.length - 1]
        const prev = nameParts[nameParts.length - 2]
        if (last && last.length <= 4) {
          size = last
          color = prev || color
        }
      }

      size = String(size).toUpperCase()
      color = String(color)
      sizeSet.add(size)
      colorSet.add(color)

      const amount = Math.round(
        parseFloat(sv.retail_price || opts.retailPrice || "0") * 100
      )

      return {
        title: `${size} / ${color}`,
        sku: `PF-${sv.id}`,
        options: { Size: size, Color: color },
        prices: [{ amount, currency_code: "usd" }],
        manage_inventory: false,
        metadata: {
          printful_sync_variant_id: sv.id,
          printful_catalog_variant_id: sv.variant_id || cat?.id,
          printful_external_id: sv.external_id,
        },
      }
    }
  )

  // Fallback if sync_variants empty — shouldn't happen
  if (!medusaVariants.length) {
    throw new Error("Printful returned no sync variants")
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

  opts.log(`Creating Medusa product handle=${handle} variants=${medusaVariants.length}`)
  const { result } = await createProductsWorkflow(container).run({
    input: { products: [productInput] },
  })

  const p = result[0]
  opts.log(`Medusa product created id=${p.id}`)

  // Verify via query (optional)
  try {
    await query.graph({
      entity: "product",
      fields: ["id", "handle", "title"],
      filters: { id: p.id },
    })
  } catch {
    // ignore
  }

  return {
    productId: p.id,
    handle: p.handle,
    title: p.title,
  }
}
