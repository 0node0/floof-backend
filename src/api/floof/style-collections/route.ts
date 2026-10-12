import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { setFloofCors } from "../../../lib/cors"
import { upsertStyleCollection } from "../../../lib/style-collections"

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
 * POST /floof/style-collections
 *
 * Create or update a style collection (landing-page metadata stored on collection.metadata).
 */
export async function OPTIONS(req: MedusaRequest, res: MedusaResponse) {
  setFloofCors(req, res)
  res.status(204).end()
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  setFloofCors(req, res)
  if (!requireAdmin(req, res)) return

  const body = (req.body || {}) as Record<string, unknown>
  const handle = String(body.handle || "").trim()
  const title = String(body.title || "").trim()

  if (!handle || !title) {
    res.status(400).json({
      error: "handle and title are required",
      example: {
        handle: "retro",
        title: "Retro",
        tagline: "Vintage vibes",
        description: "Curated retro tees",
        heroCopy: "Throwback graphics for modern closets",
        accentColors: ["#E8A87C", "#1A1A2E"],
        seoTitle: "Retro Tees | Floof",
        seoDescription: "Shop retro print-on-demand tees at Floof.",
      },
    })
    return
  }

  try {
    const result = await upsertStyleCollection(req.scope, {
      handle,
      title,
      tagline: body.tagline ? String(body.tagline) : undefined,
      description: body.description ? String(body.description) : undefined,
      heroCopy: body.heroCopy ? String(body.heroCopy) : undefined,
      accentColors: Array.isArray(body.accentColors)
        ? body.accentColors.map(String)
        : undefined,
      seoTitle: body.seoTitle ? String(body.seoTitle) : undefined,
      seoDescription: body.seoDescription ? String(body.seoDescription) : undefined,
    })

    res.status(result.created ? 201 : 200).json({
      ok: true,
      collection: result,
      storePath: `/collections/${result.handle}`,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to upsert style collection"
    console.error("[floof/style-collections]", e)
    res.status(500).json({ error: message })
  }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  setFloofCors(req, res)
  if (!requireAdmin(req, res)) return
  res.json({
    endpoint: "POST /floof/style-collections",
    auth: "x-floof-admin-key",
    body: {
      handle: "retro",
      title: "Retro",
      tagline: "optional",
      description: "optional",
      heroCopy: "optional",
      accentColors: ["#hex"],
      seoTitle: "optional",
      seoDescription: "optional",
    },
  })
}
