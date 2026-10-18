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

export function isDurableProductImageUrl(url: string): boolean {
  if (isEphemeralFloofHostedImageUrl(url)) return false
  if (/files\.cdn\.printful\.com\/files\//i.test(url)) return true
  const r2Base = (
    process.env.R2_PUBLIC_BASE_URL ||
    process.env.R2_PUBLIC_URL ||
    ""
  ).replace(/\/$/, "")
  if (r2Base && url.startsWith(`${r2Base}/`)) return true
  if (/designs\.floof\.space\//i.test(url)) return true
  return false
}
