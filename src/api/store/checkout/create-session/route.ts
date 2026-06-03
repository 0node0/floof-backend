import { Stripe } from "stripe"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * POST /store/checkout/create-session
 *
 * Creates a Stripe Checkout Session for the given cart.
 * Called from the frontend's StripeCheckoutButton.
 *
 * Body: { cart_id: string; return_url: string }
 * Returns: { session_id: string; url: string }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { cart_id, return_url } = (req.body || {}) as {
    cart_id?: string
    return_url?: string
  }

  if (!cart_id || !return_url) {
    return res.status(400).json({ error: "cart_id and return_url are required" })
  }

  const container = req.scope
  const logger = container.resolve("logger")
  const query = container.resolve("query")

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY || ""
  const backendUrl = process.env.MEDUSA_BACKEND_URL || "http://localhost:9000"

  if (!stripeSecretKey) {
    return res.status(500).json({ error: "Stripe not configured" })
  }

  try {
    // Fetch cart with all line items and shipping address
    const { data: carts } = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "email",
        "subtotal",
        "shipping_total",
        "tax_total",
        "total",
        "currency_code",
        "shipping_address.*",
        "items.*",
        "items.variant.id",
        "items.variant.title",
        "items.quantity",
        "items.unit_price",
      ],
      filters: { id: cart_id },
    })

    const cart = carts?.[0]
    if (!cart) {
      return res.status(404).json({ error: "Cart not found" })
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-12-18.acacia" as any })

    // Build line items from cart items
    const lineItems = (cart.items || []).map((item: any) => ({
      price_data: {
        currency: (cart.currency_code || "usd").toLowerCase(),
        product_data: {
          name: item.variant?.title || item.title,
        },
        unit_amount: Math.round(item.unit_price),
      },
      quantity: item.quantity,
    }))

    // Create the Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      customer_email: cart.email || undefined,
      success_url: `${return_url}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${return_url}?canceled=true`,
      metadata: {
        cart_id,
        medusa_backend_url: backendUrl,
      },
      shipping_address_collection: {
        allowed_countries: ["US"],
      },
      phone_number_collection: { enabled: true },
    })

    logger.info(`[checkout-session] Created session ${session.id} for cart ${cart_id}`)

    return res.status(200).json({
      session_id: session.id,
      url: session.url,
    })
  } catch (err: any) {
    logger.error(`[checkout-session] Failed: ${err.message}`)
    return res.status(500).json({ error: err.message })
  }
}