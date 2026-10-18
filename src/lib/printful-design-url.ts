import type PrintfulApiClient from "../modules/printful/client"
import { isEphemeralFloofHostedImageUrl } from "./ephemeral-floof-image-url"

export type SyncVariantFile = {
  id?: number
  type?: string
  url?: string
  preview_url?: string
  thumbnail_url?: string
}

/** Staged uploads and Railway `/static` disk — wiped on redeploy / not durable for Printful mockups. */
export function isEphemeralFloofDesignUrl(url: string | undefined | null): boolean {
  if (!url?.trim()) return true
  return isEphemeralFloofHostedImageUrl(url)
}

/** Printful file library CDN — safe for mockup-generator image_url. */
export function isPrintfulFileLibraryUrl(url: string): boolean {
  return /files\.cdn\.printful\.com\/files\//i.test(url)
}

export function pickDurableUrlFromFile(file: SyncVariantFile): string | undefined {
  const candidates = [file.preview_url, file.url, file.thumbnail_url].filter(
    (u): u is string => typeof u === "string" && u.trim().length > 0
  )
  for (const u of candidates) {
    if (isEphemeralFloofDesignUrl(u)) continue
    if (isPrintfulFileLibraryUrl(u)) return u
  }
  for (const u of candidates) {
    if (!isEphemeralFloofDesignUrl(u)) return u
  }
  return undefined
}

function primarySyncFiles(syncVariants: Array<{ files?: SyncVariantFile[] }>): SyncVariantFile[] {
  const out: SyncVariantFile[] = []
  for (const sv of syncVariants) {
    const files = sv.files || []
    const primary =
      files.find((f) => f.type === "default" || f.type === "front") || files[0]
    if (primary) out.push(primary)
    for (const f of files) {
      if (f !== primary) out.push(f)
    }
  }
  return out
}

async function pollPrintfulFileLibraryUrl(
  client: PrintfulApiClient,
  fileId: number,
  log?: (m: string) => void
): Promise<string | undefined> {
  for (let i = 0; i < 25; i++) {
    const f = await client.get<{
      status?: string
      url?: string
      preview_url?: string
      thumbnail_url?: string
    }>(`/files/${fileId}`)
    const picked = pickDurableUrlFromFile(f)
    if (picked && isPrintfulFileLibraryUrl(picked)) {
      return picked
    }
    const st = String(f.status || "").toLowerCase()
    if (st === "ok" || st === "ready") {
      return picked
    }
    if (st === "failed" || st === "error") {
      log?.(`Printful file ${fileId} status=${st}`)
      return undefined
    }
    await new Promise((r) => setTimeout(r, 800 + i * 200))
  }
  return undefined
}

/**
 * Resolve a Printful-fetchable design URL for mockup tasks.
 * Never returns ephemeral Floof staging URLs when a file id or CDN URL exists.
 */
export async function resolveDurablePrintfulDesignUrl(
  client: PrintfulApiClient,
  syncVariants: Array<{ files?: SyncVariantFile[] }>,
  opts?: {
    thumbnailUrl?: string
    fallbackUrls?: string[]
    log?: (m: string) => void
  }
): Promise<string | undefined> {
  const log = opts?.log
  const files = primarySyncFiles(syncVariants)

  for (const f of files) {
    const u = pickDurableUrlFromFile(f)
    if (u && isPrintfulFileLibraryUrl(u)) {
      log?.(`Design URL from sync file (CDN): ${u.slice(0, 80)}…`)
      return u
    }
  }

  for (const f of files) {
    if (f.id != null) {
      log?.(`Polling Printful /files/${f.id} for durable preview…`)
      const polled = await pollPrintfulFileLibraryUrl(client, f.id, log)
      if (polled && !isEphemeralFloofDesignUrl(polled)) {
        return polled
      }
    }
  }

  for (const f of files) {
    const u = pickDurableUrlFromFile(f)
    if (u) {
      log?.(`Design URL from sync file (non-CDN): ${u.slice(0, 80)}…`)
      return u
    }
  }

  for (const u of opts?.fallbackUrls || []) {
    if (!isEphemeralFloofDesignUrl(u) && isPrintfulFileLibraryUrl(u)) return u
  }
  for (const u of opts?.fallbackUrls || []) {
    if (!isEphemeralFloofDesignUrl(u)) return u
  }

  const thumb = opts?.thumbnailUrl
  if (thumb && !isEphemeralFloofDesignUrl(thumb)) return thumb

  return undefined
}
