import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { IEventBusModuleService } from "@medusajs/framework/types"

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
 * POST /webhooks/printful/:secretPath
 *
 * Printful's webhook API does NOT use HMAC signatures — it relies entirely
 * on the URL being unguessable. The full URL (including a random hex path)
 * is registered with Printful via POST /webhooks, and any request to that
 * exact URL is treated as authentic.
 *
 * To enable extra defense-in-depth, we verify that the trailing path
 * segment matches the PRINTFUL_WEBHOOK_PATH env var. If the env var is
 * not set, we accept any request to the base /webhooks/printful endpoint
 * (less secure — only useful for local dev / curl testing).
 *
 * Printful sends events like:
 *   - package_shipped   (the only one we subscribed to initially)
 *   - order_failed
 *   - order_canceled
 *
 * The full event payload is forwarded into the Medusa event bus so
 * subscribers can react (mark orders as fulfilled, notify customers, etc.).
 *
 * Important: Printful requires a 2xx response within ~10s, otherwise it
 * retries 6 times at 1, 4, 16, 64, 256, 1024 minutes.
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
  const eventBus = container.resolve("eventBusService") as IEventBusModuleService
  const logger = container.resolve("logger")

  // ---- Path-based auth ----
  // req.path is something like "/webhooks/printful/b066c4b5..."
  const configuredPath = process.env.PRINTFUL_WEBHOOK_PATH || ""
  const requestPath = req.path || ""
  const requestTail = requestPath.replace(/^\/webhooks\/printful\/?/, "").replace(/\/$/, "")

  if (configuredPath) {
    // Constant-time compare to avoid timing attacks
    if (requestTail.length !== configuredPath.length || requestTail !== configuredPath) {
      logger.warn(
        `[printful-webhook] Path mismatch: request=${requestPath} configured_tail=${configuredPath.slice(0, 8)}...`
      )
      return res.status(404).json({ error: "Not found" })
    }
  } else {
    logger.warn(
      "[printful-webhook] PRINTFUL_WEBHOOK_PATH not configured — accepting any request to /webhooks/printful (DEV ONLY)"
    )
  }

  // ---- Parse payload ----
  const rawBody: string =
    (req as any).rawBody ||
    (Buffer.isBuffer(req.body)
      ? (req.body as Buffer).toString("utf8")
      : JSON.stringify(req.body))

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch (err: any) {
    return res.status(400).json({ error: "Invalid JSON" })
  }

  // Printful wraps events as { type: "package_shipped", data: {...}, created: ... }
  const type = payload?.type
  const data = payload?.data || {}

  if (!type) {
    return res.status(400).json({ error: "Missing event type" })
  }

  try {
    // Map Printful event types -> Medusa event names
    // (Printful uses snake_case like "package_shipped"; we namespace under printful.*)
    const eventName = `printful.${type}`
    await eventBus.emit({ name: eventName, data: { type, data, raw: payload } })

    logger.info(`[printful-webhook] Handled event: ${type}`)
    // Printful wants 2xx fast — return immediately
    return res.status(200).json({ received: true, type })
  } catch (err: any) {
    logger.error(`[printful-webhook] Failed to handle ${type}: ${err.message}`)
    // Still return 200 to stop retries (we logged the error)
    return res.status(200).json({ received: true, error: err.message })
  }
}

/**
 * GET handler for sanity checks (so you can curl the URL to verify
 * the path check is wired correctly without triggering a real event).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const configuredPath = process.env.PRINTFUL_WEBHOOK_PATH || ""
  const requestPath = req.path || ""
  const requestTail = requestPath
    .replace(/^\/webhooks\/printful\/?/, "")
    .replace(/\/$/, "")

  const match = !configuredPath || requestTail === configuredPath
  return res.status(match ? 200 : 404).json({
    ok: match,
    configured: !!configuredPath,
    requestPath,
  })
}
