import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"

/**
 * printful.package_shipped → save tracking info on the order metadata.
 *
 * Note: Printful renamed this event from "shipment_sent" (old) to
 * "package_shipped" (current). Our webhook route forwards it as
 * `printful.package_shipped` to match Printful's actual type.
 *
 * v1 only logs the email that would be sent; v2 wires Resend/Postmark.
 *
 * The webhook handler wraps Printful's payload as:
 *   { type: "package_shipped", data: { order_id, tracking_number, ... }, raw: {...} }
 * so the actual Printful `data` object is at event.data.data.
 */
export default async function shipmentShippedHandler({
  event,
  container,
}: SubscriberArgs<any>) {
  const wrapper = event.data || {}
  const logger = container.resolve("logger")

  // Unwrap: webhook handler stores { type, data, raw }
  const data = wrapper.data || wrapper

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
  event: "printful.package_shipped",
}
