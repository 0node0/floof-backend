import type PrintfulApiClient from "../modules/printful/client"
import { isEphemeralFloofDesignUrl } from "./printful-design-url"

export type PrintfulFileLike = {
  id?: number
  url?: string
  preview_url?: string
  thumbnail_url?: string
  filename?: string
  width?: number
  height?: number
}

/** Prefer full `url` from Printful /files — not the smaller preview CDN variant. */
export function pickFullResolutionPrintfulFileUrl(
  file: PrintfulFileLike
): string | undefined {
  const ordered = [file.url, file.preview_url, file.thumbnail_url].filter(
    (u): u is string => typeof u === "string" && u.trim().length > 0
  )
  for (const u of ordered) {
    if (isEphemeralFloofDesignUrl(u)) continue
    return u
  }
  return undefined
}

export function isLikelyPrintfulPreviewUrl(url: string): boolean {
  return /preview|thumb|_thumb|_small/i.test(url)
}

export async function resolveFullPrintfulFileUrlById(
  client: PrintfulApiClient,
  fileId: number,
  log?: (m: string) => void
): Promise<{ url: string; width?: number; height?: number } | undefined> {
  try {
    const detail = await client.get<{ result?: PrintfulFileLike }>(`/files/${fileId}`)
    const file = detail?.result ?? (detail as PrintfulFileLike)
    const url = pickFullResolutionPrintfulFileUrl(file)
    if (!url) return undefined
    log?.(
      `Resolved full Printful file id=${fileId} (${file.width || "?"}×${file.height || "?"})`
    )
    return { url, width: file.width, height: file.height }
  } catch (e) {
    log?.(
      `GET /files/${fileId} failed: ${e instanceof Error ? e.message : String(e)}`
    )
    return undefined
  }
}
