/** Railway container disk and in-memory staging — not durable across redeploys. */

export function floofBackendPublicOrigin(): string {
  return (
    process.env.MEDUSA_BACKEND_URL ||
    process.env.BACKEND_URL ||
    "http://localhost:9000"
  ).replace(/\/$/, "")
}

export function isFloofStaticDiskImageUrl(url: string | undefined | null): boolean {
  if (!url?.trim()) return false
  try {
    const u = new URL(url.trim())
    const path = u.pathname.replace(/\/+/g, "/")
    if (!path.startsWith("/static/")) return false
    const origin = floofBackendPublicOrigin()
    const expected = new URL(origin)
    return u.hostname === expected.hostname
  } catch {
    return /\/static\/[^/?#]+/i.test(url)
  }
}

export function isEphemeralFloofHostedImageUrl(url: string | undefined | null): boolean {
  if (!url?.trim()) return false
  if (isFloofStaticDiskImageUrl(url)) return true
  if (/\/floof\/design-files\//i.test(url)) return true
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(url)) return true
  return false
}

/** Durable Printful **file library** CDN (`/files/` path). */
export function isPrintfulFileLibraryCdnUrl(url: string | undefined | null): boolean {
  if (!url?.trim()) return false
  return /files\.cdn\.printful\.com\/files\//i.test(url.trim())
}

/**
 * Short-lived URLs returned by mockup-generator tasks (S3 tmp, non-/files/ Printful CDN, etc.).
 * These expire and must be rehosted before storing on Medusa products.
 */
export function isEphemeralPrintfulMockupTaskUrl(url: string | undefined | null): boolean {
  if (!url?.trim()) return false
  const u = url.trim()
  if (isPrintfulFileLibraryCdnUrl(u)) return false
  if (/printful-upload\.s3/i.test(u)) return true
  if (/amazonaws\.com\/.*\/tmp\//i.test(u)) return true
  if (/files\.cdn\.printful\.com\//i.test(u) && !isPrintfulFileLibraryCdnUrl(u)) return true
  if (/\/mockup-generator\//i.test(u)) return true
  if (/i\.printful\.com\//i.test(u) && !isPrintfulFileLibraryCdnUrl(u)) return true
  return false
}

/** Any gallery URL that must be rehosted before it is safe on a product. */
export function isEphemeralProductGalleryImageUrl(url: string | undefined | null): boolean {
  if (!url?.trim()) return false
  return isEphemeralFloofHostedImageUrl(url) || isEphemeralPrintfulMockupTaskUrl(url)
}

export function isDurableProductImageUrl(url: string): boolean {
  if (isEphemeralProductGalleryImageUrl(url)) return false
  if (isPrintfulFileLibraryCdnUrl(url)) return true
  const r2Base = (
    process.env.R2_PUBLIC_BASE_URL ||
    process.env.R2_PUBLIC_URL ||
    ""
  ).replace(/\/$/, "")
  if (r2Base && url.startsWith(`${r2Base}/`)) return true
  if (/designs\.floof\.space\//i.test(url)) return true
  return false
}
