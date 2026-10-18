import type PrintfulApiClient from "../modules/printful/client"
import { putPublicObjectToR2, readR2ConfigFromEnv } from "./design-r2"
import {
  isDurableProductImageUrl,
  isEphemeralProductGalleryImageUrl,
} from "./ephemeral-floof-image-url"
import { uploadBinaryToPrintfulFileLibrary } from "./printful-file-upload"
import { rehostImageUrlViaPrintful } from "./rehost-image-url"

function contentTypeFromUrl(url: string): string {
  const lower = url.toLowerCase()
  if (lower.includes(".png")) return "image/png"
  if (lower.includes(".webp")) return "image/webp"
  if (lower.includes(".gif")) return "image/gif"
  return "image/jpeg"
}

function r2KeyFromSourceUrl(url: string): string {
  try {
    const path = new URL(url).pathname
    const base = path.split("/").pop() || `asset-${Date.now()}.png`
    const safe = base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+/, "")
    return `products/${safe || `asset-${Date.now()}.png`}`
  } catch {
    return `products/asset-${Date.now()}.png`
  }
}

export async function fetchPublicImageBuffer(
  url: string
): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch image (${res.status}): ${url}`)
  }
  const contentType = res.headers.get("content-type") || contentTypeFromUrl(url)
  const buffer = Buffer.from(await res.arrayBuffer())
  return { buffer, contentType }
}

function normalizeContentType(ct: string): "image/png" | "image/jpeg" {
  if (ct.includes("png")) return "image/png"
  return "image/jpeg"
}

export type EnsureDurableGalleryOptions = {
  r2ObjectKey?: string
  /** When true (default), throw if the result is still ephemeral. */
  strict?: boolean
}

/**
 * Rehost product gallery images to R2 or Printful file library CDN.
 * Already-durable URLs are returned unchanged.
 */
export async function ensureDurableGalleryImageUrl(
  url: string,
  log: (m: string) => void,
  client: PrintfulApiClient,
  opts?: EnsureDurableGalleryOptions
): Promise<string> {
  const strict = opts?.strict !== false
  const trimmed = url?.trim()
  if (!trimmed) {
    throw new Error("ensureDurableGalleryImageUrl: empty url")
  }
  if (isDurableProductImageUrl(trimmed)) {
    return trimmed
  }

  if (!isEphemeralProductGalleryImageUrl(trimmed) && !strict) {
    return trimmed
  }

  let result: string

  if (readR2ConfigFromEnv()) {
    const { buffer, contentType } = await fetchPublicImageBuffer(trimmed)
    const key = opts?.r2ObjectKey || r2KeyFromSourceUrl(trimmed)
    result = await putPublicObjectToR2(key, buffer, contentType)
    log(`Rehosted to R2: ${result}`)
  } else {
    const viaUrl = await rehostImageUrlViaPrintful(client, trimmed, log, { strict })
    if (viaUrl !== trimmed && isDurableProductImageUrl(viaUrl)) {
      result = viaUrl
    } else {
      const { buffer, contentType } = await fetchPublicImageBuffer(trimmed)
      const filename = r2KeyFromSourceUrl(trimmed).split("/").pop() || "product.png"
      const uploaded = await uploadBinaryToPrintfulFileLibrary(
        client,
        buffer,
        filename,
        normalizeContentType(contentType),
        log
      )
      result = uploaded.cdnUrl
    }
  }

  if (strict && !isDurableProductImageUrl(result)) {
    throw new Error(
      `Rehost did not produce a durable URL (still ephemeral). source=${trimmed.slice(0, 96)}… result=${result.slice(0, 96)}…`
    )
  }
  return result
}

/** @deprecated use ensureDurableGalleryImageUrl */
export async function ensureDurablePublicImageUrl(
  url: string,
  log: (m: string) => void,
  client?: PrintfulApiClient | null,
  opts?: { r2ObjectKey?: string }
): Promise<string> {
  const trimmed = url?.trim()
  if (!trimmed) return url
  if (isDurableProductImageUrl(trimmed)) return trimmed
  if (!isEphemeralProductGalleryImageUrl(trimmed)) return trimmed
  if (!client) {
    throw new Error(
      "R2 is not configured and Printful client was not provided — cannot rehost ephemeral image"
    )
  }
  return ensureDurableGalleryImageUrl(trimmed, log, client, {
    r2ObjectKey: opts?.r2ObjectKey,
    strict: true,
  })
}
