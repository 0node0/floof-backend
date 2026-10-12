import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ADMIN_CORS, STORE_CORS } from "./env"

function parseOriginList(csv: string): string[] {
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Allowed browser origins for Floof design / admin APIs. */
export function floofDesignAllowedOrigins(): string[] {
  const combined = [...parseOriginList(STORE_CORS), ...parseOriginList(ADMIN_CORS)]
  return [...new Set(combined)]
}

/**
 * Reflect Origin when allowed; omit ACAO for disallowed browser origins.
 * Non-browser clients (no Origin) are unaffected.
 */
export function setFloofCors(req: MedusaRequest, res: MedusaResponse) {
  const allowed = floofDesignAllowedOrigins()
  const origin = req.headers.origin as string | undefined
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-floof-admin-key, Authorization"
  )
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS")
  if (origin && allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin)
    res.setHeader("Vary", "Origin")
  }
}
