import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /health
 * Lightweight health check for Railway uptime monitoring and Docker HEALTHCHECK.
 */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  return res.status(200).json({
    status: "ok",
    service: "floof-backend",
    timestamp: new Date().toISOString(),
  })
}
