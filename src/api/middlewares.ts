import { defineMiddlewares } from "@medusajs/framework/http"
import type { MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework/http"

// In-memory rate limiter — fine for Railway's single-node deployment.
const store = new Map<string, { count: number; resetAt: number }>()

function rateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = store.get(key)
  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (entry.count >= maxRequests) return false
  entry.count++
  return true
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key)
  }
}, 300_000).unref?.()

async function storeRateLimit(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
    (req as any).ip ||
    "unknown"

  if (!rateLimit(`store:${ip}`, 60, 60_000)) {
    res.status(429).json({ error: "Too many requests — please slow down" })
    return
  }
  next()
}

/**
 * Medusa middleware config:
 *  - Preserve raw body for Stripe signature verification
 *  - Rate-limit /store/* at 60 req/min per IP
 */
export default defineMiddlewares({
  routes: [
    {
      method: ["POST"],
      matcher: "/webhooks/stripe",
      bodyParser: { preserveRawBody: true },
    },
    {
      matcher: "/store/*",
      middlewares: [storeRateLimit],
    },
  ],
})
