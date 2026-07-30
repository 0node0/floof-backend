import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  createProductFromDesign,
  importPrintfulProductToMedusa,
  type CreateFromDesignInput,
  type GarmentKind,
} from "../../../lib/product-from-design"
import { publicDesignUrl, stageDesignFile } from "../../../lib/design-staging"

function setCors(res: MedusaResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-floof-admin-key, Authorization")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
}

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
 * POST /floof/design-products
 *
 * Auth: x-floof-admin-key
 *
 * JSON body:
 *   { name, designUrl, garment?, colors?, sizes?, retailPrice?, ... }
 *
 * OR multipart / base64 JSON:
 *   { name, designBase64: "data:image/png;base64,…" | raw base64, filename? }
 *   Stages file and builds a temporary public URL for Printful.
 */
export async function OPTIONS(_req: MedusaRequest, res: MedusaResponse) {
  setCors(res)
  res.status(204).end()
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  setCors(res)
  if (!requireAdmin(req, res)) return

  const body = (req.body || {}) as Record<string, any>

  // Resume / refresh: import Printful product, optionally regenerate lifestyle mockups
  if (body.importPrintfulProductId) {
    try {
      const result = await importPrintfulProductToMedusa(
        Number(body.importPrintfulProductId),
        req.scope,
        {
          phrase: body.phrase,
          category: body.category,
          description: body.description,
          regenerateMockups:
            body.regenerateMockups === true || body.regenerateMockups === "true",
          catalogProductId: body.catalogProductId
            ? Number(body.catalogProductId)
            : undefined,
        }
      )
      res.status(201).json({
        ok: true,
        imported: true,
        printful: result.printful,
        mockups: result.mockups,
        gallery: result.gallery,
        medusa: result.medusa,
        storeUrl: result.medusa
          ? `https://www.floof.space/products/${result.medusa.handle}`
          : null,
        logs: result.logs,
      })
    } catch (e: any) {
      console.error("[floof/design-products import]", e)
      res.status(500).json({ error: e.message || "Import failed" })
    }
    return
  }

  let designUrl = (body.designUrl as string) || ""
  const name = (body.name as string) || ""

  // Support base64 payload from Studio upload
  if (!designUrl && body.designBase64) {
    try {
      let b64 = String(body.designBase64)
      let contentType = "image/png"
      const dataUrl = /^data:([^;]+);base64,(.+)$/i.exec(b64)
      if (dataUrl) {
        contentType = dataUrl[1]
        b64 = dataUrl[2]
      }
      const buffer = Buffer.from(b64, "base64")
      if (buffer.length < 100) {
        res.status(400).json({ error: "designBase64 too small" })
        return
      }
      if (buffer.length > 15 * 1024 * 1024) {
        res.status(400).json({ error: "design max 15MB" })
        return
      }
      const id = stageDesignFile({
        buffer,
        contentType,
        filename: body.filename || `${name || "design"}.png`,
      })
      designUrl = publicDesignUrl(id)
    } catch (e: any) {
      res.status(400).json({ error: `Invalid designBase64: ${e.message}` })
      return
    }
  }

  if (!name || !designUrl) {
    res.status(400).json({
      error: "name and designUrl (or designBase64) are required",
      example: {
        name: "Humidity Club",
        designUrl: "https://cdn.example.com/design.png",
        garment: "tee",
        colors: ["Black", "White"],
        sizes: ["S", "M", "L", "XL", "2XL"],
        retailPrice: "28.00",
      },
    })
    return
  }

  const garment = (body.garment === "hoodie" ? "hoodie" : "tee") as GarmentKind

  const input: CreateFromDesignInput = {
    name,
    designUrl,
    description: body.description,
    garment,
    catalogProductId: body.catalogProductId
      ? Number(body.catalogProductId)
      : undefined,
    colors: body.colors,
    sizes: body.sizes,
    retailPrice: body.retailPrice,
    category: body.category,
    generateMockups: body.generateMockups !== false && body.generateMockups !== "false",
    mockupOptionGroups: body.mockupOptionGroups,
    phrase: body.phrase,
  }

  try {
    const result = await createProductFromDesign(input, req.scope)
    res.status(201).json({
      ok: true,
      designUrlUsed: designUrl,
      printful: result.printful,
      mockups: result.mockups,
      gallery: result.gallery,
      medusa: result.medusa,
      storeUrl: result.medusa
        ? `https://www.floof.space/products/${result.medusa.handle}`
        : null,
      logs: result.logs,
    })
  } catch (e: any) {
    console.error("[floof/design-products]", e)
    res.status(500).json({
      error: e.message || "Failed to create product from design",
    })
  }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  setCors(res)
  if (!requireAdmin(req, res)) return
  res.json({
    endpoint: "POST /floof/design-products",
    auth: "x-floof-admin-key",
    body: {
      name: "required",
      designUrl: "public HTTPS URL to PNG",
      designBase64: "alternative: data URL or raw base64",
      garment: "tee | hoodie",
      colors: ["Black", "White"],
      sizes: ["S", "M", "L", "XL", "2XL"],
      retailPrice: "28.00",
      generateMockups: true,
    },
  })
}
