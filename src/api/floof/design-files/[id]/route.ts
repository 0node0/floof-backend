import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getStagedDesign } from "../../../../lib/design-staging"

/**
 * Public temporary design fetch for Printful file library.
 * GET /floof/design-files/:id
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const id = (req.params.id as string)?.replace(/\.(png|jpg|jpeg|webp)$/i, "")
  if (!id) {
    res.status(400).json({ error: "missing id" })
    return
  }
  const entry = getStagedDesign(id)
  if (!entry) {
    res.status(404).json({ error: "not found or expired" })
    return
  }
  res.setHeader("Content-Type", entry.contentType)
  res.setHeader("Cache-Control", "public, max-age=600")
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${entry.filename.replace(/"/g, "")}"`
  )
  res.status(200).send(entry.buffer)
}
