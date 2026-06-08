// Event types that Printful's webhook API actually emits (verified against
// https://developers.printful.com/docs/ Webhook API section).
// We only subscribe to a subset of these (see Railway API call), but
// keeping the full list in the type allows forward-compat.
export type PrintfulWebhookType =
  | "package_shipped"
  | "order_failed"
  | "order_canceled"
  | "order_updated"
  | "stock_updated"
  | "product_synced"
  | "product_deleted"
  | "shipment_returned"
  | "shipment_outlined"

export interface PrintfulWebhookPayload {
  type: PrintfulWebhookType
  data: {
    order_id?: number
    tracking_number?: string
    tracking_url?: string
    carrier?: string
    status?: string
    [key: string]: unknown
  }
}