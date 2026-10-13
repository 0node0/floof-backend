import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createProductVariantsWorkflow,
  updateProductsWorkflow,
} from "@medusajs/medusa/core-flows"

export type MedusaVariantRef = {
  id: string
  sku?: string | null
  metadata?: Record<string, unknown> | null
}

export type PrintfulBackedMedusaVariant = {
  title: string
  sku: string
  syncVariantId: number
  options: { Size: string; Color: string }
  prices: Array<{ amount: number; currency_code: string }>
  metadata: {
    printful_sync_variant_id: number
    printful_catalog_variant_id?: number
    printful_external_id?: string
  }
}

export function printfulSyncVariantSku(syncVariantId: number): string {
  return `PF-${syncVariantId}`
}

export function findExistingVariantForPrintfulSync(
  existing: MedusaVariantRef[],
  desired: Pick<PrintfulBackedMedusaVariant, "sku" | "syncVariantId">
): MedusaVariantRef | undefined {
  const bySku = existing.find((v) => v.sku === desired.sku)
  if (bySku) return bySku
  return existing.find((v) => {
    const raw = v.metadata?.printful_sync_variant_id
    const id =
      typeof raw === "number"
        ? raw
        : typeof raw === "string" && /^\d+$/.test(raw)
          ? Number(raw)
          : undefined
    return id === desired.syncVariantId
  })
}

export type VariantSyncPlan = {
  toUpdate: Array<{ existingId: string; variant: PrintfulBackedMedusaVariant }>
  toCreate: PrintfulBackedMedusaVariant[]
}

/** Updates must not include prices — Medusa storefront prices stay as configured. */
export function buildMedusaVariantUpdatePayload(
  existingId: string,
  variant: PrintfulBackedMedusaVariant
): {
  id: string
  title: string
  sku: string
  options: { Size: string; Color: string }
  manage_inventory: boolean
  metadata: PrintfulBackedMedusaVariant["metadata"]
} {
  return {
    id: existingId,
    title: variant.title,
    sku: variant.sku,
    options: variant.options,
    manage_inventory: false,
    metadata: variant.metadata,
  }
}

export function planIdempotentVariantSync(
  existing: MedusaVariantRef[],
  desired: PrintfulBackedMedusaVariant[]
): VariantSyncPlan {
  const toUpdate: VariantSyncPlan["toUpdate"] = []
  const toCreate: PrintfulBackedMedusaVariant[] = []

  for (const variant of desired) {
    const match = findExistingVariantForPrintfulSync(existing, variant)
    if (match) {
      toUpdate.push({ existingId: match.id, variant })
    } else {
      toCreate.push(variant)
    }
  }

  return { toUpdate, toCreate }
}

/** Parse Printful sync_variant rows into Medusa variant payloads. */
export function buildMedusaVariantsFromPrintfulSync(
  syncVariants: Array<{
    id: number
    name?: string
    retail_price?: string
    variant_id?: number
    external_id?: string
    product?: { name?: string }
  }>,
  defaultRetailPrice = "28.00"
): { variants: PrintfulBackedMedusaVariant[]; sizes: string[]; colors: string[] } {
  const sizes = new Set<string>()
  const colors = new Set<string>()
  const variants: PrintfulBackedMedusaVariant[] = []

  for (const sv of syncVariants) {
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
      const m = String(sv.product.name).match(/\(([^/]+)\/([^)]+)\)/)
      if (m) {
        color = m[1].trim()
        size = m[2].trim()
      }
    }

    size = String(size).toUpperCase()
    color = String(color)
    sizes.add(size)
    colors.add(color)

    const amount = Math.round(
      parseFloat(sv.retail_price || defaultRetailPrice || "0") * 100
    )
    const sku = printfulSyncVariantSku(sv.id)

    variants.push({
      title: `${size} / ${color}`,
      sku,
      syncVariantId: sv.id,
      options: { Size: size, Color: color },
      prices: [{ amount, currency_code: "usd" }],
      metadata: {
        printful_sync_variant_id: sv.id,
        printful_catalog_variant_id: sv.variant_id,
        printful_external_id: sv.external_id,
      },
    })
  }

  return { variants, sizes: Array.from(sizes), colors: Array.from(colors) }
}

export async function findMedusaProductForPrintfulImport(
  container: MedusaContainer,
  opts: {
    printfulProductId: number
    productHandle: string
    syncVariants: Array<{ id: number }>
  }
): Promise<{ id: string; handle: string; title: string } | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const wantHandle = opts.productHandle
  const skus = opts.syncVariants.map((sv) => printfulSyncVariantSku(sv.id))

  try {
    const { data: prods } = await query.graph({
      entity: "product",
      fields: [
        "id",
        "handle",
        "title",
        "metadata",
        "variants.id",
        "variants.sku",
        "variants.metadata",
      ],
    })
    const match = (prods || []).find((p: any) => {
      const mid = p.metadata?.printful_product_id
      if (mid == opts.printfulProductId || mid === String(opts.printfulProductId)) {
        return true
      }
      if (p.handle === wantHandle) return true
      const variantSkus = (p.variants || []).map((v: any) => v.sku)
      return skus.some((sku) => variantSkus.includes(sku))
    })
    if (match) {
      return { id: match.id, handle: match.handle, title: match.title }
    }
  } catch {
    /* fall through */
  }
  return null
}

export async function findMedusaProductIdByVariantSku(
  container: MedusaContainer,
  sku: string
): Promise<string | undefined> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_variant",
    fields: ["id", "sku", "product_id"],
    filters: { sku },
  })
  const row = (data || [])[0] as { product_id?: string } | undefined
  return row?.product_id
}

export async function listMedusaVariantsForProduct(
  container: MedusaContainer,
  productId: string
): Promise<MedusaVariantRef[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "variants.id", "variants.sku", "variants.metadata"],
    filters: { id: productId },
  })
  const product = (data || [])[0] as {
    variants?: MedusaVariantRef[]
  } | undefined
  return product?.variants || []
}

/**
 * Update existing variants in place; create only variants that are missing.
 * Matches by SKU or metadata.printful_sync_variant_id.
 */
export async function syncMedusaProductVariantsIdempotent(
  container: MedusaContainer,
  productId: string,
  syncVariants: Array<{
    id: number
    name?: string
    retail_price?: string
    variant_id?: number
    external_id?: string
    product?: { name?: string }
  }>,
  defaultRetailPrice: string,
  log?: (m: string) => void
): Promise<{ updated: number; created: number }> {
  const { variants: desired } = buildMedusaVariantsFromPrintfulSync(
    syncVariants,
    defaultRetailPrice
  )
  if (!desired.length) {
    throw new Error("No Printful sync variants to sync to Medusa")
  }

  const existing = await listMedusaVariantsForProduct(container, productId)
  const plan = planIdempotentVariantSync(existing, desired)

  log?.(
    `Variant sync plan for ${productId}: update=${plan.toUpdate.length} create=${plan.toCreate.length} (existing=${existing.length})`
  )

  if (plan.toUpdate.length) {
    await updateProductsWorkflow(container).run({
      input: {
        products: [
          {
            id: productId,
            variants: plan.toUpdate.map(({ existingId, variant }) =>
              buildMedusaVariantUpdatePayload(existingId, variant)
            ),
          },
        ],
      } as any,
    })
  }

  if (plan.toCreate.length) {
    await createProductVariantsWorkflow(container).run({
      input: {
        product_variants: plan.toCreate.map((variant) => ({
          product_id: productId,
          title: variant.title,
          sku: variant.sku,
          options: variant.options,
          prices: variant.prices,
          manage_inventory: false,
          metadata: variant.metadata,
        })),
      },
    })
  }

  return { updated: plan.toUpdate.length, created: plan.toCreate.length }
}
