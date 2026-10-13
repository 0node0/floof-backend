import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { setFloofCors } from "../../../../lib/cors"
import { getMaintenanceJob } from "../../../../lib/maintenance-jobs"

function requireAdmin(req: MedusaRequest, res: MedusaResponse): boolean {
  const expected = process.env.FLOOF_ADMIN_KEY || ""
  const provided =
    (req.headers["x-floof-admin-key"] as string) ||
    (req.headers["authorization"] as string)?.replace(/^Bearer\s+/i, "") ||
    ""

  if (!expected) {
    res.status(503).json({ error: "FLOOF_ADMIN_KEY is not configured on the backend" })
    return false
  }
  if (!provided || provided !== expected) {
    res.status(401).json({ error: "Unauthorized — set x-floof-admin-key" })
    return false
  }
  return true
}

/**
 * GET /floof/maintenance-jobs/:jobId
 * Poll async maintenance started via POST /floof/design-products (mugs or apparel).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  setFloofCors(req, res)
  if (!requireAdmin(req, res)) return

  const jobId = req.params.jobId as string
  const job = getMaintenanceJob(jobId)
  if (!job) {
    res.status(404).json({ error: "Job not found or expired" })
    return
  }

  res.status(200).json({
    ok: true,
    kind: job.kind,
    jobId: job.id,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    result: job.result,
  })
}

export async function OPTIONS(req: MedusaRequest, res: MedusaResponse) {
  setFloofCors(req, res)
  res.status(204).end()
}
