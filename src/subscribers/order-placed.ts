import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"
import type { IEventBusModuleService } from "@medusajs/framework/types"

/**
 * order.placed → submit the order to Printful for production.
 * Printful's two-step flow: create draft → confirm.
 */
export default async function orderPlacedHandler({
  event,
  container,
}: SubscriberArgs<{ order_id: string }>) {
  const orderId = event.data.order_id
  const logger = container.resolve("logger")
  const query = container.resolve("query")
  const eventBus = container.resolve("eventBusService") as IEventBusModuleService

  let printful: any
  try {
    printful = container.resolve("printful")
  } catch (err: any) {
    logger.error(`[order-placed] printful module not registered: ${err.message}`)
    return
  }

  logger.info(`[order-placed] Processing order ${orderId}`)

  try {
    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "shipping_address.*",
        "items.*",
        "items.variant.id",
        "items.variant.sku",
        "items.variant.metadata",
        "items.quantity",
        "items.unit_price",
        "currency_code",
      ],
      filters: { id: orderId },
    })

    const order = orders?.[0]
    if (!order) {
      logger.error(`[order-placed] Order ${orderId} not found`)
      return
    }

    const addr = order.shipping_address
    if (!addr) {
      logger.error(`[order-placed] Order ${orderId} has no shipping address`)
      return
    }

    const items = (order.items || [])
      .filter((item: any) => item.variant?.sku?.startsWith("PF-"))
      .map((item: any) => ({
        external_variant_id: item.variant.sku,
        quantity: item.quantity,
        retail_price: ((item.unit_price || 0) / 100).toFixed(2),
      }))

    if (items.length === 0) {
      logger.warn(`[order-placed] Order ${orderId} has no Printful items — skipping`)
      return
    }

    const payload = {
      external_id: `floof_${order.display_id}`,
      recipient: {
        name: `${addr.first_name || ""} ${addr.last_name || ""}`.trim(),
        address1: addr.address_1 || "",
        address2: addr.address_2 || "",
        city: addr.city || "",
        state_code: addr.province || "",
        country_code: addr.country_code || "US",
        zip: addr.postal_code || "",
        email: (order as any).email || "",
        phone: addr.phone || "",
      },
      items,
    }

    const draft = await printful.createOrder(payload)
    logger.info(`[order-placed] Printful draft created: ${draft?.id}`)

    const confirmed = await printful.confirmOrder(draft.id)
    logger.info(
      `[order-placed] Printful order confirmed: ${confirmed?.id} status=${confirmed?.status}`
    )

    await eventBus.emit({
      name: "printful.order_submitted",
      data: {
        order_id: orderId,
        printful_order_id: confirmed?.id || draft?.id,
      },
    })
  } catch (err: any) {
    logger.error(`[order-placed] Printful submission failed for ${orderId}: ${err.message}`)
    await eventBus.emit({
      name: "printful.order_failed",
      data: {
        order_id: orderId,
        reason: err.message,
      },
    })
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
