import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"

/**
 * Pull Printful store products into Medusa as published catalog items.
 *
 * SKUs are set to `PF-{sync_variant_id}` so order-placed can submit to Printful
 * using sync_variant_id (parsed from the SKU).
 *
 * Env: PRINTFUL_API_TOKEN (or PRINTFUL_API_KEY), optional PRINTFUL_STORE_ID
 */
export default async function syncPrintfulProducts({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const productModule = container.resolve(Modules.PRODUCT)
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL)

  const token =
    process.env.PRINTFUL_API_TOKEN || process.env.PRINTFUL_API_KEY || ""
  const storeId = process.env.PRINTFUL_STORE_ID || ""

  if (!token) {
    throw new Error("PRINTFUL_API_TOKEN is not set")
  }

  logger.info("--- Printful → Medusa product sync ---")

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "FloofSync/1.0",
  }
  if (storeId) headers["X-PF-Store-Id"] = storeId

  async function pfGet(path: string): Promise<any> {
    const res = await fetch(`https://api.printful.com${path}`, { headers })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Printful GET ${path} -> ${res.status}: ${body}`)
    }
    const json = await res.json()
    return json.result ?? json
  }

  const list = (await pfGet("/store/products")) as any[]
  logger.info(`Found ${list.length} Printful store product(s)`)

  let channel = (
    await salesChannelModule.listSalesChannels({ name: "Default Sales Channel" })
  )[0]
  if (!channel) {
    const channels = await salesChannelModule.listSalesChannels({}, { take: 1 })
    channel = channels[0]
  }
  if (!channel) {
    throw new Error("No sales channel found — run seed first")
  }

  // Existing handles for idempotency
  const existing = await productModule.listProducts({}, { take: 500 })
  const existingHandles = new Set(existing.map((p: any) => p.handle))
  const existingSkus = new Set<string>()
  for (const p of existing) {
    const variants = (p as any).variants || []
    for (const v of variants) {
      if (v.sku) existingSkus.add(v.sku)
    }
  }

  // Also load variants via query for SKUs if listProducts doesn't expand them
  try {
    const { data: prods } = await query.graph({
      entity: "product",
      fields: ["id", "handle", "variants.sku"],
    })
    for (const p of prods || []) {
      existingHandles.add(p.handle)
      for (const v of p.variants || []) {
        if (v.sku) existingSkus.add(v.sku)
      }
    }
  } catch {
    // ignore
  }

  const toCreate: any[] = []

  for (const item of list) {
    const detail = await pfGet(`/store/products/${item.id}`)
    const syncProduct = detail.sync_product || detail
    const syncVariants = detail.sync_variants || []

    const name: string = syncProduct.name || item.name || `Printful ${item.id}`
    const handle = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")

    if (existingHandles.has(handle)) {
      logger.info(`Skip existing handle: ${handle}`)
      continue
    }

    const phrase = name
      .replace(/^FLOOF\s*-\s*/i, "")
      .split(/\s+/)
      .slice(0, 3)
      .join(" ")

    // Thumbnail: product thumbnail or first variant preview
    let imageUrl =
      syncProduct.thumbnail_url ||
      item.thumbnail_url ||
      ""
    if (!imageUrl && syncVariants[0]) {
      const preview = (syncVariants[0].files || []).find(
        (f: any) => f.type === "preview" || f.type === "default"
      )
      imageUrl = preview?.preview_url || preview?.thumbnail_url || ""
    }

    // Build options from variant names (Size from "Name / S")
    const sizes = new Set<string>()
    const colors = new Set<string>()
    for (const v of syncVariants) {
      const parts = String(v.name || "").split("/")
      const size = (parts[1] || "One Size").trim()
      sizes.add(size)
      // Color from catalog product name if present
      const productName = v.product?.name || ""
      const colorMatch = productName.match(/\(([^/]+)\s*\//)
      const color = colorMatch ? colorMatch[1].trim() : "Default"
      colors.add(color)
      ;(v as any)._size = size
      ;(v as any)._color = color
    }

    const sizeValues = Array.from(sizes)
    const colorValues = Array.from(colors)

    const variants = syncVariants
      .filter((v: any) => {
        const sku = `PF-${v.id}`
        if (existingSkus.has(sku)) {
          logger.info(`Skip existing SKU ${sku}`)
          return false
        }
        return true
      })
      .map((v: any) => {
        const amount = Math.round(parseFloat(v.retail_price || "0") * 100)
        return {
          title: `${v._size} / ${v._color}`,
          sku: `PF-${v.id}`,
          options: {
            Size: v._size,
            Color: v._color,
          },
          prices: [
            {
              amount,
              currency_code: (v.currency || "USD").toLowerCase(),
            },
          ],
          manage_inventory: false,
          metadata: {
            printful_sync_variant_id: v.id,
            printful_catalog_variant_id: v.variant_id,
            printful_external_id: v.external_id,
          },
        }
      })

    if (variants.length === 0) {
      logger.info(`No new variants for ${name}`)
      continue
    }

    const lower = name.toLowerCase()
    const category = lower.includes("hoodie") || lower.includes("sweatshirt")
      ? "hoodies"
      : lower.includes("hat") || lower.includes("cap") || lower.includes("beanie")
        ? "hats"
        : "tees"

    const productInput: any = {
      title: name,
      handle,
      description: `${name} — printed on demand by Floof × Printful.`,
      status: "published",
      options: [
        { title: "Size", values: sizeValues },
        { title: "Color", values: colorValues },
      ],
      variants,
      sales_channels: [{ id: channel.id }],
      metadata: {
        printful_product_id: syncProduct.id || item.id,
        category,
        phrase,
      },
    }

    if (imageUrl) {
      productInput.images = [{ url: imageUrl }]
      productInput.thumbnail = imageUrl
    }

    toCreate.push(productInput)
    existingHandles.add(handle)
    for (const v of variants) existingSkus.add(v.sku)
  }

  if (toCreate.length === 0) {
    logger.info("Nothing new to create.")
    logger.info("--- Sync complete ---")
    return
  }

  logger.info(`Creating ${toCreate.length} Medusa product(s)...`)
  const { result } = await createProductsWorkflow(container).run({
    input: { products: toCreate },
  })

  for (const p of result) {
    logger.info(`Created product ${p.id} handle=${p.handle}`)
  }

  logger.info("--- Sync complete ---")
}
