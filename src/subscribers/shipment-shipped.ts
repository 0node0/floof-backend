import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"

/**
 * printful.shipment_sent → save tracking info on the order metadata.
 * v1 only logs the email that would be sent; v2 wires Resend/Postmark.
 */
export default async function shipmentShippedHandler({
  event,
  container,
}: SubscriberArgs<{
  order_id?: string
  tracking_number?: string
  tracking_url?: string
  carrier?: string
}>) {
  const data = event.data || {}
  const logger = container.resolve("logger")

  const orderId = data.order_id
  if (!orderId) {
    logger.warn(`[shipment-shipped] No order_id in event payload`)
    return
  }

  logger.info(
    `[shipment-shipped] Order ${orderId} shipped: tracking=${data.tracking_number} carrier=${data.carrier}`
  )

  // TODO v2: send transactional email via Resend/Postmark
  // For now we just log; tracking already saved to Medusa by Printful
}

export const config: SubscriberConfig = {
  event: "printful.shipment_sent",
}
