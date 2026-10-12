/**
 * Checkout-related env configuration (shipping, tax, Printful confirm).
 */

function parseUsdToCents(raw: string | undefined, defaultCents: number): number {
  if (!raw?.trim()) return defaultCents
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return defaultCents
  // Allow whole dollars (e.g. "75") or explicit cents when value looks like cents
  if (raw.includes(".") || n >= 1000) {
    return Math.round(n * (raw.includes(".") ? 100 : 1))
  }
  return Math.round(n * 100)
}

function parseCents(raw: string | undefined, defaultCents: number): number {
  if (!raw?.trim()) return defaultCents
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return defaultCents
  return Math.round(n)
}

function parseBool(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw === "") return defaultValue
  const v = raw.trim().toLowerCase()
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true
  if (v === "0" || v === "false" || v === "no" || v === "off") return false
  return defaultValue
}

/** Subtotal at or above this (cents) qualifies for free shipping. Default $75. */
export function shippingFreeThresholdCents(): number {
  if (process.env.SHIPPING_FREE_THRESHOLD_CENTS) {
    return parseCents(process.env.SHIPPING_FREE_THRESHOLD_CENTS, 7500)
  }
  return parseUsdToCents(process.env.SHIPPING_FREE_THRESHOLD_USD, 7500)
}

/** Flat-rate shipping in cents when Printful rates are unavailable. Default $6.99. */
export function shippingFlatRateCents(): number {
  if (process.env.SHIPPING_FLAT_RATE_CENTS) {
    return parseCents(process.env.SHIPPING_FLAT_RATE_CENTS, 699)
  }
  return parseUsdToCents(process.env.SHIPPING_FLAT_RATE_USD, 699)
}

/** When true, use Printful /shipping/rates when the cart has a US shipping address. */
export function shippingUsePrintfulRates(): boolean {
  return parseBool(process.env.SHIPPING_USE_PRINTFUL_RATES, true)
}

/** Stripe Checkout automatic tax (requires Stripe Tax enabled in Dashboard). Default off. */
export function stripeAutomaticTaxEnabled(): boolean {
  return parseBool(process.env.STRIPE_AUTOMATIC_TAX, false)
}

/** When false, Printful orders stay as drafts after order.placed. Default true. */
export function printfulAutoConfirm(): boolean {
  return parseBool(process.env.PRINTFUL_AUTO_CONFIRM, true)
}

export type CartLineForShipping = {
  quantity: number
  catalogVariantId: number | null
}

export function cartSubtotalCents(items: { quantity: number; unit_price: number }[]): number {
  return items.reduce(
    (sum, item) => sum + Math.round(item.unit_price || 0) * (item.quantity || 0),
    0
  )
}

export type ShippingQuote = {
  amountCents: number
  displayName: string
  source: "free" | "printful" | "flat"
  printfulRateId?: string
}

/**
 * Resolve shipping charge for Stripe Checkout (US only).
 * Free shipping when subtotal meets threshold; otherwise Printful quote or flat rate.
 */
export function resolveShippingQuote(
  subtotalCents: number,
  quote: { amountCents: number; displayName: string; source: "printful" | "flat" } | null
): ShippingQuote {
  if (subtotalCents >= shippingFreeThresholdCents()) {
    return { amountCents: 0, displayName: "Free shipping", source: "free" }
  }
  if (quote && quote.amountCents >= 0) {
    return { ...quote, source: quote.source }
  }
  const flat = shippingFlatRateCents()
  return {
    amountCents: flat,
    displayName: "Standard shipping",
    source: "flat",
  }
}
