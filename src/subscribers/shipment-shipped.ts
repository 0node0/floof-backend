import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"
import {
  createOrderFulfillmentWorkflow,
  createOrderShipmentWorkflow,
} from "@medusajs/medusa/core-flows"
import { Modules } from "@medusajs/framework/utils"

/**
 * printful.package_shipped → create fulfillment + shipment on the Medusa order.
 *
 * Printful payload shape (wrapped by our webhook route as { type, data, raw }):
 *   data.order.id          — Printful order id
 *   data.order.external_id — our external_id, e.g. "floof_42"
 *   data.shipment.tracking_number / tracking_url / carrier
 */
export default async function shipmentShippedHandler({
  event,
  container,
}: SubscriberArgs<any>) {
  const wrapper = event.data || {}
  const logger = container.resolve("logger")
  const query = container.resolve("query")

  const data = wrapper.data || wrapper
  const printfulOrder = data.order || {}
  const shipment = data.shipment || data

  const externalId: string | undefined =
    printfulOrder.external_id || data.external_id
  const printfulOrderId = printfulOrder.id || data.order_id
  const trackingNumber =
    shipment.tracking_number || data.tracking_number || undefined
  const trackingUrl = shipment.tracking_url || data.tracking_url || undefined
  const carrier = shipment.carrier || data.carrier || "Printful"

  logger.info(
    `[shipment-shipped] external_id=${externalId} printful_order_id=${printfulOrderId} tracking=${trackingNumber}`
  )

  // Resolve Medusa order: by metadata.printful_order_id or external_id floof_{display_id}
  let order: any = null
  try {
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "display_id", "metadata", "items.*", "items.id", "items.quantity"],
      filters: {},
    })

    order = (orders || []).find((o: any) => {
      if (printfulOrderId && o.metadata?.printful_order_id == printfulOrderId) return true
      if (externalId && o.metadata?.printful_external_id === externalId) return true
      if (externalId?.startsWith("floof_")) {
        const display = externalId.replace(/^floof_/, "")
        return String(o.display_id) === display
      }
      return false
    })
  } catch (err: any) {
    logger.error(`[shipment-shipped] Failed to query orders: ${err.message}`)
    return
  }

  if (!order) {
    logger.warn(
      `[shipment-shipped] No Medusa order matched external_id=${externalId} printful_order_id=${printfulOrderId}`
    )
    return
  }

  if (order.metadata?.printful_shipped) {
    logger.info(`[shipment-shipped] Order ${order.id} already marked shipped — skipping`)
    return
  }

  const items = (order.items || []).map((item: any) => ({
    id: item.id,
    quantity: item.quantity,
  }))

  if (items.length === 0) {
    logger.warn(`[shipment-shipped] Order ${order.id} has no items to fulfill`)
    return
  }

  try {
    const { result: fulfillment } = await createOrderFulfillmentWorkflow(container).run({
      input: {
        order_id: order.id,
        items,
        no_notification: true,
      },
    })

    if (fulfillment?.id) {
      await createOrderShipmentWorkflow(container).run({
        input: {
          order_id: order.id,
          fulfillment_id: fulfillment.id,
          items,
          labels:
            trackingNumber || trackingUrl
              ? [
                  {
                    tracking_number: trackingNumber || "unknown",
                    tracking_url: trackingUrl || "",
                    label_url: trackingUrl || "",
                  } as any,
                ]
              : undefined,
        },
      })
    }

    // Persist tracking on order metadata
    try {
      const orderModule = container.resolve(Modules.ORDER) as any
      await orderModule.updateOrders(order.id, {
        metadata: {
          ...(order.metadata || {}),
          printful_shipped: true,
          tracking_number: trackingNumber,
          tracking_url: trackingUrl,
          carrier,
        },
      })
    } catch (err: any) {
      logger.warn(`[shipment-shipped] Could not update order metadata: ${err.message}`)
    }

    logger.info(
      `[shipment-shipped] Order ${order.id} fulfilled + shipped tracking=${trackingNumber}`
    )
  } catch (err: any) {
    logger.error(
      `[shipment-shipped] Failed to fulfill/ship order ${order.id}: ${err.message}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "printful.package_shipped",
}
