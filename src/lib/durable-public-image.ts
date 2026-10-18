import type PrintfulApiClient from "../modules/printful/client"
import { putPublicObjectToR2, readR2ConfigFromEnv } from "./design-r2"
import {
  isDurableProductImageUrl,
  isEphemeralFloofHostedImageUrl,
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

/**
 * Rehost Floof `/static` (Railway disk) or `/floof/design-files` URLs to R2 or Printful CDN.
 */
export async function ensureDurablePublicImageUrl(
  url: string,
  log: (m: string) => void,
  client?: PrintfulApiClient | null,
  opts?: { r2ObjectKey?: string }
): Promise<string> {
  const trimmed = url?.trim()
  if (!trimmed) return url
  if (!isEphemeralFloofHostedImageUrl(trimmed)) {
    return trimmed
  }

  if (readR2ConfigFromEnv()) {
    const { buffer, contentType } = await fetchPublicImageBuffer(trimmed)
    const key = opts?.r2ObjectKey || r2KeyFromSourceUrl(trimmed)
    const publicUrl = await putPublicObjectToR2(key, buffer, contentType)
    log(`Rehosted to R2: ${publicUrl}`)
    return publicUrl
  }

  if (!client) {
    throw new Error(
      "R2 is not configured and Printful client was not provided — cannot rehost ephemeral image"
    )
  }

  const viaUrl = await rehostImageUrlViaPrintful(client, trimmed, log)
  if (viaUrl !== trimmed && isDurableProductImageUrl(viaUrl)) {
    return viaUrl
  }

  const { buffer, contentType } = await fetchPublicImageBuffer(trimmed)
  const filename = r2KeyFromSourceUrl(trimmed).split("/").pop() || "product.png"
  const uploaded = await uploadBinaryToPrintfulFileLibrary(
    client,
    buffer,
    filename,
    normalizeContentType(contentType),
    log
  )
  return uploaded.cdnUrl
}
