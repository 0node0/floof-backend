import type Stripe from "stripe"

/**
 * Stripe Checkout fields for automatic tax.
 *
 * Guest checkout uses `customer_email`, not `customer`. `customer_update` requires
 * an existing Stripe Customer and will error if set without `customer`.
 */
export function stripeAutomaticTaxFields(
  enabled: boolean
): Pick<Stripe.Checkout.SessionCreateParams, "automatic_tax"> | Record<string, never> {
  if (!enabled) return {}
  return { automatic_tax: { enabled: true } }
}
