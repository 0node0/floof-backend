import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"
import type { IEventBusModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

/**
 * order.placed → submit the order to Printful for production.
 * Printful's two-step flow: create draft → confirm.
 *
 * Medusa emits { id }; our custom checkout path also sends { order_id }.
 */
export default async function orderPlacedHandler({
  event,
  container,
}: SubscriberArgs<{ id?: string; order_id?: string }>) {
  const orderId = event.data.id || event.data.order_id
  const logger = container.resolve("logger")
  const query = container.resolve("query")
  const eventBus = container.resolve("eventBusService") as IEventBusModuleService

  if (!orderId) {
    logger.error("[order-placed] Missing order id in event payload")
    return
  }

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
        "email",
        "metadata",
        "shipping_address.*",
        "items.*",
        "items.variant.id",
        "items.variant.sku",
        "items.variant.metadata",
        "items.quantity",
        "items.unit_price",
        "items.metadata",
        "currency_code",
      ],
      filters: { id: orderId },
    })

    const order = orders?.[0]
    if (!order) {
      logger.error(`[order-placed] Order ${orderId} not found`)
      return
    }

    // Idempotency: skip if already submitted to Printful
    if (order.metadata?.printful_order_id) {
      logger.info(
        `[order-placed] Order ${orderId} already has printful_order_id=${order.metadata.printful_order_id} — skipping`
      )
      return
    }

    const addr = order.shipping_address
    if (!addr) {
      logger.error(`[order-placed] Order ${orderId} has no shipping address`)
      return
    }

    const items = (order.items || [])
      .filter((item: any) => {
        const sku = item.variant?.sku || item.metadata?.sku || ""
        return String(sku).startsWith("PF-")
      })
      .map((item: any) => ({
        external_variant_id: item.variant?.sku || item.metadata?.sku,
        quantity: item.quantity,
        retail_price: ((item.unit_price || 0) / 100).toFixed(2),
      }))

    if (items.length === 0) {
      logger.warn(`[order-placed] Order ${orderId} has no Printful items (PF-* SKUs) — skipping`)
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
        country_code: (addr.country_code || "US").toUpperCase(),
        zip: addr.postal_code || "",
        email: order.email || "",
        phone: addr.phone || "",
      },
      items,
    }

    const draft = await printful.createOrder(payload)
    logger.info(`[order-placed] Printful draft created: ${draft?.id}`)

    const confirmed = await printful.confirmOrder(draft.id)
    const printfulOrderId = confirmed?.id || draft?.id
    logger.info(
      `[order-placed] Printful order confirmed: ${printfulOrderId} status=${confirmed?.status}`
    )

    // Persist Printful id for idempotency + shipment mapping
    try {
      const orderModule = container.resolve(Modules.ORDER) as any
      await orderModule.updateOrders(orderId, {
        metadata: {
          ...(order.metadata || {}),
          printful_order_id: printfulOrderId,
          printful_external_id: `floof_${order.display_id}`,
        },
      })
    } catch (err: any) {
      logger.warn(`[order-placed] Could not update order metadata: ${err.message}`)
    }

    await eventBus.emit({
      name: "printful.order_submitted",
      data: {
        order_id: orderId,
        printful_order_id: printfulOrderId,
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
