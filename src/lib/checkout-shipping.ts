import type { MedusaContainer } from "@medusajs/framework/types"
import {
  cartSubtotalCents,
  resolveShippingQuote,
  shippingUsePrintfulRates,
  type CartLineForShipping,
  type ShippingQuote,
} from "./checkout-config"

type CartAddress = {
  address_1?: string
  city?: string
  province?: string
  postal_code?: string
  country_code?: string
}

export async function quoteShippingForCart(
  container: MedusaContainer,
  cart: {
    items?: Array<{
      quantity: number
      unit_price: number
      variant?: { metadata?: Record<string, unknown> }
      metadata?: Record<string, unknown>
    }>
    shipping_address?: CartAddress | null
  }
): Promise<ShippingQuote> {
  const items = cart.items || []
  const subtotalCents = cartSubtotalCents(items)
  const addr = cart.shipping_address

  let printfulQuote: { amountCents: number; displayName: string; source: "printful" | "flat" } | null =
    null

  if (shippingUsePrintfulRates() && hasUsAddress(addr)) {
    const lines: CartLineForShipping[] = items.map((item) => ({
      quantity: item.quantity,
      catalogVariantId: catalogVariantIdFromItem(item),
    }))
    const shippable = lines.filter((l) => l.catalogVariantId && l.quantity > 0)
    if (shippable.length) {
      try {
        const printful = container.resolve("printful") as {
          getShippingRates: (
            recipient: Record<string, string>,
            items: { variant_id: number; quantity: number }[]
          ) => Promise<
            Array<{
              id?: string
              name?: string
              rate?: string
              currency?: string
            }>
          >
        }
        const rates = await printful.getShippingRates(
          {
            address1: addr!.address_1 || "",
            city: addr!.city || "",
            state_code: addr!.province || "",
            country_code: (addr!.country_code || "US").toUpperCase(),
            zip: addr!.postal_code || "",
          },
          shippable.map((l) => ({
            variant_id: l.catalogVariantId!,
            quantity: l.quantity,
          }))
        )
        const picked = pickCheapestRate(rates)
        if (picked) {
          printfulQuote = {
            amountCents: picked.amountCents,
            displayName: picked.displayName,
            source: "printful",
          }
        }
      } catch {
        // Fall back to flat rate via resolveShippingQuote
      }
    }
  }

  return resolveShippingQuote(subtotalCents, printfulQuote)
}

function hasUsAddress(addr?: CartAddress | null): boolean {
  if (!addr?.postal_code || !addr.address_1 || !addr.city) return false
  const cc = (addr.country_code || "US").toUpperCase()
  return cc === "US" || cc === "USA"
}

function catalogVariantIdFromItem(item: {
  variant?: { metadata?: Record<string, unknown> }
  metadata?: Record<string, unknown>
}): number | null {
  const meta =
    item.variant?.metadata?.printful_catalog_variant_id ||
    item.metadata?.printful_catalog_variant_id
  if (meta == null || meta === "") return null
  const n = Number(meta)
  return Number.isFinite(n) && n > 0 ? n : null
}

function pickCheapestRate(
  rates: Array<{ id?: string; name?: string; rate?: string; currency?: string }>
): { amountCents: number; displayName: string; rateId?: string } | null {
  let best: { amountCents: number; displayName: string; rateId?: string } | null = null
  for (const r of rates || []) {
    const amount = Math.round(parseFloat(r.rate || "0") * 100)
    if (!Number.isFinite(amount) || amount < 0) continue
    const displayName = r.name || "Standard shipping"
    if (!best || amount < best.amountCents) {
      best = { amountCents: amount, displayName, rateId: r.id }
    }
  }
  return best
}

export function stripeShippingOptions(quote: ShippingQuote, currency: string) {
  return [
    {
      shipping_rate_data: {
        type: "fixed_amount" as const,
        fixed_amount: {
          amount: quote.amountCents,
          currency: currency.toLowerCase(),
        },
        display_name: quote.displayName,
      },
    },
  ]
}

export function shippingAmountFromStripeSession(session: {
  total_details?: { amount_shipping?: number | null; amount_tax?: number | null } | null
  shipping_cost?: { amount_total?: number | null } | null
}): { shippingCents: number; taxCents: number } {
  const shippingCents =
    session.shipping_cost?.amount_total ??
    session.total_details?.amount_shipping ??
    0
  const taxCents = session.total_details?.amount_tax ?? 0
  return { shippingCents, taxCents }
}
