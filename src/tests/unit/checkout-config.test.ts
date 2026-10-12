import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  cartSubtotalCents,
  resolveShippingQuote,
  shippingFreeThresholdCents,
  printfulAutoConfirm,
  stripeAutomaticTaxEnabled,
} from "../../lib/checkout-config"

describe("checkout-config", () => {
  const env = process.env

  beforeEach(() => {
    process.env = { ...env }
  })

  afterEach(() => {
    process.env = env
  })

  it("defaults free shipping threshold to $75", () => {
    delete process.env.SHIPPING_FREE_THRESHOLD_USD
    delete process.env.SHIPPING_FREE_THRESHOLD_CENTS
    expect(shippingFreeThresholdCents()).toBe(7500)
  })

  it("applies free shipping at threshold", () => {
    delete process.env.SHIPPING_FREE_THRESHOLD_USD
    const subtotal = 8000
    const quote = resolveShippingQuote(subtotal, {
      amountCents: 699,
      displayName: "Standard",
      source: "flat",
    })
    expect(quote.amountCents).toBe(0)
    expect(quote.source).toBe("free")
  })

  it("uses flat rate below threshold when no Printful quote", () => {
    process.env.SHIPPING_FLAT_RATE_USD = "5.00"
    const quote = resolveShippingQuote(1000, null)
    expect(quote.amountCents).toBe(500)
    expect(quote.source).toBe("flat")
  })

  it("sums cart subtotal in cents", () => {
    expect(
      cartSubtotalCents([
        { quantity: 2, unit_price: 2800 },
        { quantity: 1, unit_price: 1000 },
      ])
    ).toBe(6600)
  })

  it("PRINTFUL_AUTO_CONFIRM defaults true", () => {
    delete process.env.PRINTFUL_AUTO_CONFIRM
    expect(printfulAutoConfirm()).toBe(true)
  })

  it("STRIPE_AUTOMATIC_TAX defaults false", () => {
    delete process.env.STRIPE_AUTOMATIC_TAX
    expect(stripeAutomaticTaxEnabled()).toBe(false)
  })
})
