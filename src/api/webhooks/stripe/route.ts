import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { IEventBusModuleService } from "@medusajs/framework/types"

// Simple in-memory rate limiter (per IP)
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
 * POST /webhooks/stripe
 *
 * Stripe webhook receiver. Verifies the signature, then emits a
 * Medusa event so downstream subscribers can react.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)
      ?.split(",")[0]
      ?.trim() || "unknown"
  if (!checkRateLimit(`stripe:${ip}`, 120)) {
    return res.status(429).json({ error: "Too many requests" })
  }

  const container = req.scope
  const eventBus = container.resolve("eventBusService") as IEventBusModuleService
  const logger = container.resolve("logger")

  // Get the raw body — required for signature verification
  const rawBody: string =
    (req as any).rawBody ||
    (Buffer.isBuffer(req.body) ? (req.body as Buffer).toString("utf8") : JSON.stringify(req.body))

  const signature = req.headers["stripe-signature"] as string | undefined
  if (!rawBody || !signature) {
    return res.status(400).json({ error: "Missing body or signature" })
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY || ""
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || ""
  if (!webhookSecret) {
    logger.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured")
    return res.status(500).json({ error: "Webhook not configured" })
  }

  try {
    const { default: Stripe } = await import("stripe")
    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-12-18.acacia" as any })

    const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)

    switch (event.type) {
      case "payment_intent.succeeded": {
        const intent = event.data.object as any
        await eventBus.emit("stripe.payment_succeeded", {
          payment_intent_id: intent.id,
          amount: intent.amount,
          currency: intent.currency,
          metadata: intent.metadata,
        })
        break
      }
      case "payment_intent.payment_failed": {
        const intent = event.data.object as any
        await eventBus.emit("stripe.payment_failed", {
          payment_intent_id: intent.id,
          metadata: intent.metadata,
        })
        break
      }
      default:
        // Unhandled event types are no-ops; Stripe sends many.
        break
    }

    return res.status(200).json({ received: true })
  } catch (err: any) {
    logger.error(`[stripe-webhook] Verification failed: ${err.message}`)
    return res.status(400).json({ error: err.message })
  }
}
