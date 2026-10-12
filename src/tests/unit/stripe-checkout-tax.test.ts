import { describe, it, expect } from "vitest"
import { stripeAutomaticTaxFields } from "../../lib/stripe-checkout-tax"

describe("stripeAutomaticTaxFields", () => {
  it("returns empty object when automatic tax is off", () => {
    expect(stripeAutomaticTaxFields(false)).toEqual({})
  })

  it("enables automatic_tax without customer_update for guest checkout", () => {
    const fields = stripeAutomaticTaxFields(true)
    expect(fields).toEqual({ automatic_tax: { enabled: true } })
    expect(fields).not.toHaveProperty("customer_update")
  })
})
