import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  createProductFromDesign,
  importPrintfulProductToMedusa,
  type CreateFromDesignInput,
  type GarmentKind,
} from "../../../lib/product-from-design"
import { publicDesignUrl, stageDesignFile } from "../../../lib/design-staging"
import { setFloofCors } from "../../../lib/cors"
import { maintainMugDesignProducts } from "../../../lib/maintain-mug-products"
import {
  applyApparelProductGallery,
  maintainApparelPlacements,
} from "../../../lib/maintain-apparel-placements"
import { migrateEphemeralProductImages } from "../../../lib/migrate-ephemeral-product-images"
import { startMugMaintenanceJob } from "../../../lib/mug-maintenance-jobs"
import { startApparelMaintenanceJob } from "../../../lib/apparel-maintenance-jobs"
import { parseApparelLayout } from "../../../lib/apparel-placement-layout"

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
export async function OPTIONS(req: MedusaRequest, res: MedusaResponse) {
  setFloofCors(req, res)
  res.status(204).end()
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  setFloofCors(req, res)
  if (!requireAdmin(req, res)) return

  const body = (req.body || {}) as Record<string, any>

  if (body.maintenance === "regenerateMugMockups") {
    const input = {
      regenerateMockups:
        body.regenerateMockups !== false && body.regenerateMockups !== "false",
      stripFloofPrefix:
        body.stripFloofPrefix !== false && body.stripFloofPrefix !== "false",
      dryRun: body.dryRun === true || body.dryRun === "true",
      productIds: Array.isArray(body.productIds)
        ? body.productIds.map(String)
        : undefined,
      regenerateProducts: Array.isArray(body.regenerateProducts)
        ? body.regenerateProducts.map(String)
        : Array.isArray(body.productNames)
          ? body.productNames.map(String)
          : undefined,
      onlyIfGalleryImagesBelow:
        body.onlySparseGalleries === true || body.onlySparseGalleries === "true"
          ? 2
          : body.onlyIfGalleryImagesBelow != null
            ? Number(body.onlyIfGalleryImagesBelow)
            : undefined,
      sourceUrls:
        body.sourceUrls && typeof body.sourceUrls === "object" && !Array.isArray(body.sourceUrls)
          ? Object.fromEntries(
              Object.entries(body.sourceUrls as Record<string, unknown>).map(([k, v]) => [
                k,
                String(v),
              ])
            )
          : undefined,
      regenerateAllMugs:
        body.regenerateAllMugs === true || body.regenerateAllMugs === "true",
    }
    const runSync = body.sync === true || body.sync === "true" || body.async === false

    if (runSync) {
      try {
        const result = await maintainMugDesignProducts(req.scope, input)
        res.status(200).json({ ok: true, maintenance: true, sync: true, ...result })
      } catch (e: any) {
        console.error("[floof/design-products maintenance]", e)
        res.status(500).json({ error: e.message || "Maintenance failed" })
      }
      return
    }

    try {
      const job = startMugMaintenanceJob(req.scope, input)
      const base =
        process.env.MEDUSA_BACKEND_URL ||
        process.env.BACKEND_URL ||
        "http://localhost:9000"
      const statusUrl = `${base.replace(/\/$/, "")}/floof/maintenance-jobs/${job.id}`
      res.status(202).json({
        ok: true,
        maintenance: true,
        async: true,
        jobId: job.id,
        status: job.status,
        statusUrl,
        poll: `GET ${statusUrl} with x-floof-admin-key`,
      })
    } catch (e: any) {
      console.error("[floof/design-products maintenance async]", e)
      res.status(500).json({ error: e.message || "Failed to start maintenance job" })
    }
    return
  }

  if (body.maintenance === "migrateEphemeralProductImages") {
    try {
      const result = await migrateEphemeralProductImages(req.scope, {
        dryRun: body.dryRun === true || body.dryRun === "true",
        handlePrefix:
          body.handlePrefix != null ? String(body.handlePrefix) : undefined,
        productIds: Array.isArray(body.productIds)
          ? body.productIds.map(String)
          : undefined,
      })
      res.status(200).json({ ok: true, maintenance: "migrateEphemeralProductImages", ...result })
    } catch (e: any) {
      console.error("[floof/design-products migrateEphemeralProductImages]", e)
      res.status(500).json({ error: e.message || "migrateEphemeralProductImages failed" })
    }
    return
  }

  if (body.maintenance === "applyGallery") {
    const productId = body.productId != null ? String(body.productId) : ""
    const imageUrls = Array.isArray(body.imageUrls)
      ? body.imageUrls.map((u: unknown) => String(u))
      : []
    try {
      const result = await applyApparelProductGallery(req.scope, {
        productId,
        imageUrls,
      })
      res.status(200).json({ ok: true, maintenance: "applyGallery", ...result })
    } catch (e: any) {
      console.error("[floof/design-products applyGallery]", e)
      res.status(400).json({ error: e.message || "applyGallery failed" })
    }
    return
  }

  if (body.maintenance === "regenerateApparelPlacements") {
    const layouts: Record<string, "leftChest" | "chestPlusBack" | "centred"> = {}
    if (body.layouts && typeof body.layouts === "object" && !Array.isArray(body.layouts)) {
      for (const [k, v] of Object.entries(body.layouts as Record<string, unknown>)) {
        const layout = parseApparelLayout(v)
        if (layout) layouts[k] = layout
      }
    }
    const products = Array.isArray(body.products)
      ? body.products
          .map((row: Record<string, unknown>) => {
            const productId = row.productId ?? row.id
            const layout = parseApparelLayout(row.layout)
            if (!productId || !layout) return null
            return { productId: String(productId), layout }
          })
          .filter(Boolean)
      : undefined

    const apparelInput = {
      dryRun: body.dryRun === true || body.dryRun === "true",
      mockupsOnly: body.mockupsOnly === true || body.mockupsOnly === "true",
      reviewOnly: body.reviewOnly === true || body.reviewOnly === "true",
      productIds: Array.isArray(body.productIds)
        ? body.productIds.map(String)
        : undefined,
      layouts,
      products: products as Array<{ productId: string; layout: "leftChest" | "chestPlusBack" | "centred" }> | undefined,
      sourceUrls:
        body.sourceUrls && typeof body.sourceUrls === "object" && !Array.isArray(body.sourceUrls)
          ? Object.fromEntries(
              Object.entries(body.sourceUrls as Record<string, unknown>).map(([k, v]) => [
                k,
                String(v),
              ])
            )
          : undefined,
    }
    const runSync = body.sync === true || body.sync === "true" || body.async === false

    if (runSync) {
      try {
        const result = await maintainApparelPlacements(req.scope, apparelInput)
        res.status(200).json({ ok: true, maintenance: true, sync: true, ...result })
      } catch (e: any) {
        console.error("[floof/design-products apparel maintenance]", e)
        res.status(500).json({ error: e.message || "Apparel maintenance failed" })
      }
      return
    }

    try {
      const job = startApparelMaintenanceJob(req.scope, apparelInput)
      const base =
        process.env.MEDUSA_BACKEND_URL ||
        process.env.BACKEND_URL ||
        "http://localhost:9000"
      const statusUrl = `${base.replace(/\/$/, "")}/floof/maintenance-jobs/${job.id}`
      res.status(202).json({
        ok: true,
        maintenance: true,
        async: true,
        jobId: job.id,
        status: job.status,
        statusUrl,
        poll: `GET ${statusUrl} with x-floof-admin-key`,
      })
    } catch (e: any) {
      console.error("[floof/design-products apparel maintenance async]", e)
      res.status(500).json({ error: e.message || "Failed to start apparel maintenance job" })
    }
    return
  }

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
      const id = await stageDesignFile({
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
    style: body.style ? String(body.style) : undefined,
    draft: body.draft === true || body.draft === "true",
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
  setFloofCors(req, res)
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
      style: "retro",
      draft: false,
    },
    maintenance: {
      maintenance: "regenerateMugMockups",
      regenerateMockups: true,
      stripFloofPrefix: true,
      dryRun: false,
      productIds: ["optional-medusa-product-id"],
      sync: false,
      onlySparseGalleries: true,
      onlyIfGalleryImagesBelow: 2,
      note: "Default async — returns jobId; poll GET /floof/maintenance-jobs/:jobId",
    },
    apparelMaintenance: {
      maintenance: "regenerateApparelPlacements",
      products: [{ productId: "medusa-product-id", layout: "leftChest | chestPlusBack | centred" }],
      layouts: { "medusa-product-id": "centred" },
      productIds: ["medusa-product-id"],
      dryRun: false,
      sync: false,
      reviewOnly:
        "optional with regenerateApparelPlacements: collect all mockup candidates, no validation, no Medusa gallery",
      note: "Async by default — poll GET /floof/maintenance-jobs/:jobId",
    },
    migrateEphemeralProductImages: {
      maintenance: "migrateEphemeralProductImages",
      dryRun: true,
      handlePrefix: "flower-crown-",
      note:
        "Sync — rehost api.floof.space/static and /floof/design-files gallery URLs to R2 (if configured) or Printful CDN",
    },
    applyGallery: {
      maintenance: "applyGallery",
      productId: "medusa-product-id",
      imageUrls: ["https://…"],
      note: "Sync only — replaces product gallery with exactly these URLs (rehosts via Printful when needed)",
    },
  })
}
