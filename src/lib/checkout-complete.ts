import type { MedusaContainer } from "@medusajs/framework/types"
import { createOrderWorkflow } from "@medusajs/medusa/core-flows"
import type Stripe from "stripe"

/**
 * After Stripe Checkout Session completes, create a Medusa order from the cart
 * and emit order.placed so Printful fulfillment runs.
 *
 * Hosted Checkout lives outside Medusa's payment-session flow, so we cannot
 * use completeCartWorkflow (it requires an authorized payment session).
 * Instead we build the order from cart + Stripe session details.
 */
export async function fulfillCheckoutSession(
  container: MedusaContainer,
  session: Stripe.Checkout.Session
): Promise<{ orderId: string | null; skipped?: boolean }> {
  const logger = container.resolve("logger") as {
    info: (m: string) => void
    warn: (m: string) => void
    error: (m: string) => void
  }
  const query = container.resolve("query") as {
    graph: (args: any) => Promise<{ data: any[] }>
  }
  const eventBus = container.resolve("eventBusService") as {
    emit: (msg: { name: string; data: Record<string, unknown> } | any) => Promise<void>
  }

  const cartId = session.metadata?.cart_id
  if (!cartId) {
    logger.error(
      `[checkout-complete] Session ${session.id} missing metadata.cart_id`
    )
    return { orderId: null }
  }

  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    logger.warn(
      `[checkout-complete] Session ${session.id} payment_status=${session.payment_status} — not creating order`
    )
    return { orderId: null }
  }

  // Idempotency: skip if we already created an order for this session
  try {
    const { data: existing } = await query.graph({
      entity: "order",
      fields: ["id", "metadata"],
      filters: {},
    })
    const already = (existing || []).find(
      (o: any) => o.metadata?.stripe_session_id === session.id
    )
    if (already) {
      logger.info(
        `[checkout-complete] Order already exists for session ${session.id}: ${already.id}`
      )
      return { orderId: already.id, skipped: true }
    }
  } catch (err: any) {
    // Graph filter on metadata may not be supported on all versions — fall through
    logger.warn(`[checkout-complete] Idempotency scan failed: ${err.message}`)
  }

  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "email",
      "currency_code",
      "region_id",
      "sales_channel_id",
      "customer_id",
      "shipping_address.*",
      "billing_address.*",
      "items.*",
      "items.variant_id",
      "items.variant.id",
      "items.variant.sku",
      "items.variant.title",
      "items.title",
      "items.quantity",
      "items.unit_price",
      "items.metadata",
      "metadata",
    ],
    filters: { id: cartId },
  })

  const cart = carts?.[0]
  if (!cart) {
    logger.error(`[checkout-complete] Cart ${cartId} not found`)
    return { orderId: null }
  }

  if (!cart.items?.length) {
    logger.error(`[checkout-complete] Cart ${cartId} has no items`)
    return { orderId: null }
  }

  // Prefer Stripe-collected shipping; fall back to cart address
  const shipping = shippingFromStripe(session) || addressFromCart(cart.shipping_address)
  const email =
    session.customer_details?.email ||
    session.customer_email ||
    cart.email ||
    undefined

  const items = (cart.items || []).map((item: any) => ({
    variant_id: item.variant_id || item.variant?.id,
    quantity: item.quantity,
    title: item.title || item.variant?.title || "Item",
    unit_price: item.unit_price,
    metadata: {
      ...(item.metadata || {}),
      sku: item.variant?.sku,
    },
  }))

  logger.info(
    `[checkout-complete] Creating order for cart ${cartId} session ${session.id} (${items.length} items)`
  )

  const { result: order } = await createOrderWorkflow(container).run({
    input: {
      region_id: cart.region_id,
      sales_channel_id: cart.sales_channel_id || undefined,
      customer_id: cart.customer_id || undefined,
      email,
      currency_code: (cart.currency_code || "usd").toLowerCase(),
      status: "pending",
      items,
      shipping_address: shipping || undefined,
      billing_address: shipping || undefined,
      metadata: {
        cart_id: cartId,
        stripe_session_id: session.id,
        stripe_payment_intent:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id || null,
        stripe_payment_status: session.payment_status,
        payment_status: "captured",
      },
    },
  })

  const orderId = order.id
  logger.info(`[checkout-complete] Created order ${orderId} for cart ${cartId}`)

  // Trigger Printful path (order-placed subscriber)
  await eventBus.emit({
    name: "order.placed",
    data: { id: orderId, order_id: orderId },
  })

  return { orderId }
}

function shippingFromStripe(session: Stripe.Checkout.Session) {
  const details = session.shipping_details || (session as any).collected_information?.shipping_details
  const addr = details?.address
  if (!addr) return null

  const name: string = details?.name || session.customer_details?.name || ""
  const [first_name, ...rest] = name.trim().split(/\s+/)
  const last_name = rest.join(" ") || first_name

  return {
    first_name: first_name || "Customer",
    last_name: last_name || "",
    address_1: addr.line1 || "",
    address_2: addr.line2 || "",
    city: addr.city || "",
    province: addr.state || "",
    postal_code: addr.postal_code || "",
    country_code: (addr.country || "US").toLowerCase(),
    phone: session.customer_details?.phone || "",
  }
}

function addressFromCart(addr: any) {
  if (!addr) return null
  return {
    first_name: addr.first_name || "Customer",
    last_name: addr.last_name || "",
    address_1: addr.address_1 || "",
    address_2: addr.address_2 || "",
    city: addr.city || "",
    province: addr.province || "",
    postal_code: addr.postal_code || "",
    country_code: (addr.country_code || "us").toLowerCase(),
    phone: addr.phone || "",
  }
}
