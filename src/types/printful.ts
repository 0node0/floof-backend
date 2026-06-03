export type PrintfulWebhookType = "order_updated" | "shipment_sent" | "stock_updated"

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