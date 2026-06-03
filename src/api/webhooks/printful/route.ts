import { createHmac, timingSafeEqual } from "crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

const rateLimit = new Map<string, { count: number; resetAt: number }>()
function checkRateLimit(key: string, max = 120, windowMs = 60_000): boolean {
  const now = Date.now()
  const entry = rateLimit.get(key)
  if (!entry || now > entry.resetAt) {
    rateLimit.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (entry.count >= max) return false
  entry.count++
  return true
}

/**
 * POST /webhooks/printful
 *
 * Verifies the Printful HMAC signature (X-Printful-Signature header),
 * then emits a typed Medusa event.
 *
 * Printful sends events like:
 *   - order_updated   (status changes, payments confirmed)
 *   - shipment_sent   (tracking number is in data)
 *   - stock_updated
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)
      ?.split(",")[0]
      ?.trim() || "unknown"
  if (!checkRateLimit(`printful:${ip}`, 120)) {
    return res.status(429).json({ error: "Too many requests" })
  }

  const container = req.scope
  const eventBus = container.resolve("eventBusService")
  const logger = container.resolve("logger")

  // Get raw body
  const rawBody: string =
    (req as any).rawBody ||
    (Buffer.isBuffer(req.body) ? (req.body as Buffer).toString("utf8") : JSON.stringify(req.body))

  const signature = req.headers["x-printful-signature"] as string | undefined
  const webhookSecret = process.env.PRINTFUL_WEBHOOK_SECRET || ""

  // Verify HMAC if a secret is configured
  if (webhookSecret) {
    if (!signature) {
      return res.status(400).json({ error: "Missing X-Printful-Signature header" })
    }
    const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("base64")
    const sigBuf = Buffer.from(signature)
    const expBuf = Buffer.from(expected)
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      logger.error("[printful-webhook] HMAC verification failed")
      return res.status(400).json({ error: "Invalid signature" })
    }
  } else {
    logger.warn("[printful-webhook] PRINTFUL_WEBHOOK_SECRET not configured — accepting unsigned webhooks (DEV ONLY)")
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch (err: any) {
    return res.status(400).json({ error: "Invalid JSON" })
  }

  const type = payload?.type
  const data = payload?.data || {}

  try {
    switch (type) {
      case "shipment_sent":
        await eventBus.emit("printful.shipment_sent", data)
        break
      case "order_updated":
        await eventBus.emit("printful.order_updated", data)
        break
      case "stock_updated":
        await eventBus.emit("printful.stock_updated", data)
        break
      default:
        logger.info(`[printful-webhook] Unhandled event type: ${type}`)
    }
    return res.status(200).json({ received: true })
  } catch (err: any) {
    logger.error(`[printful-webhook] Failed to handle ${type}: ${err.message}`)
    return res.status(500).json({ error: err.message })
  }
}
