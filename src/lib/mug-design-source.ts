import type PrintfulApiClient from "../modules/printful/client"
import {
  isLikelyMugWrapAssetUrl,
  isMugWrapImageDimensions,
} from "./mug-wrap-asset-detect"
import {
  isLikelyPrintfulPreviewUrl,
  resolveFullPrintfulFileUrlById,
} from "./printful-file-url"
import sharp from "sharp"

export const DESIGN_SOURCE_FILE_ID_META = "designSourceFileId"
export const DESIGN_SOURCE_URL_META = "designSourceUrl"

export type MugDesignSourceResolution = {
  url: string
  fileId?: number
  sourceWidth?: number
  sourceHeight?: number
  source:
    | "sourceUrls_override"
    | "metadata_url"
    | "metadata_file_id"
    | "printful_file_library"
  /** Persist on Medusa when discovered during maintenance */
  backfillMetadata?: {
    designSourceFileId?: number
    designSourceUrl?: string
  }
}

export class MugWrapSourceRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MugWrapSourceRefusedError"
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

async function imageDimensions(png: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(png).metadata()
  return { width: meta.width || 0, height: meta.height || 0 }
}

export function readDesignSourceFromMetadata(
  metadata?: Record<string, unknown>
): { fileId?: number; url?: string } {
  const rawId = metadata?.[DESIGN_SOURCE_FILE_ID_META]
  const fileId =
    typeof rawId === "number"
      ? rawId
      : typeof rawId === "string" && /^\d+$/.test(rawId)
        ? Number(rawId)
        : undefined
  const url =
    typeof metadata?.[DESIGN_SOURCE_URL_META] === "string"
      ? metadata[DESIGN_SOURCE_URL_META]
      : undefined
  return { fileId, url }
}

/**
 * Refuse mug wraps and composite print files as design input (PR #15/#16).
 */
export async function assertSingleSidedDesignPng(
  png: Buffer,
  context?: { url?: string }
): Promise<Buffer> {
  const { width, height } = await imageDimensions(png)
  const url = context?.url || ""
  if (isLikelyMugWrapAssetUrl(url)) {
    throw new MugWrapSourceRefusedError(
      `Refusing mug wrap URL as design source: ${url.slice(0, 96)}`
    )
  }
  if (isMugWrapImageDimensions(width, height)) {
    throw new MugWrapSourceRefusedError(
      `Refusing wrap-shaped image (${width}×${height}) as design source — use original single-sided art`
    )
  }
  return png
}

export async function fetchAndAssertSingleSidedDesignPng(
  designUrl: string,
  log?: (m: string) => void
): Promise<Buffer> {
  const res = await fetch(designUrl)
  if (!res.ok) {
    throw new Error(`Failed to fetch design (${res.status}): ${designUrl.slice(0, 80)}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  try {
    await assertSingleSidedDesignPng(buf, { url: designUrl })
  } catch (e) {
    log?.(e instanceof Error ? e.message : String(e))
    throw e
  }
  return buf
}

type PrintfulFileListItem = {
  id: number
  filename?: string
  url?: string
  preview_url?: string
  thumbnail_url?: string
  width?: number
  height?: number
}

function isWrapListItem(file: PrintfulFileListItem): boolean {
  const fn = (file.filename || "").toLowerCase()
  if (fn.includes("mug-wrap")) return true
  if (file.width && file.height && isMugWrapImageDimensions(file.width, file.height)) {
    return true
  }
  return false
}

function fileMatchesMugProduct(
  file: PrintfulFileListItem,
  title: string,
  handle: string,
  phrase?: string
): boolean {
  const fn = (file.filename || "").toLowerCase()
  if (!fn || isWrapListItem(file)) return false
  const slug = slugify(title)
  const handleNorm = handle.toLowerCase()
  if (fn === `${slug}.png` || fn.startsWith(`${slug}-`) || fn.includes(slug)) return true
  if (fn.includes(handleNorm)) return true
  if (phrase) {
    const phraseSlug = slugify(phrase)
    if (phraseSlug && (fn === `${phraseSlug}.png` || fn.includes(phraseSlug))) return true
  }
  return false
}

async function listPrintfulFilesPage(
  client: PrintfulApiClient,
  offset: number,
  limit: number
): Promise<PrintfulFileListItem[]> {
  const res = await client.get<{ result?: { files?: PrintfulFileListItem[] } }>(
    `/files?offset=${offset}&limit=${limit}`
  )
  const files = res?.result?.files ?? (res as { files?: PrintfulFileListItem[] }).files ?? []
  return files
}

/**
 * Oldest Printful file-library entry matching product slug (creation upload), excluding wraps.
 */
export async function discoverOriginalDesignFileFromLibrary(
  client: PrintfulApiClient,
  opts: {
    title: string
    handle: string
    phrase?: string
    log?: (m: string) => void
  }
): Promise<{ fileId: number; url: string; width?: number; height?: number } | undefined> {
  const log = opts.log
  const limit = 100
  const maxPages = Number(process.env.PRINTFUL_FILE_LIBRARY_SCAN_PAGES || 30)
  const matches: PrintfulFileListItem[] = []

  for (let page = 0; page < maxPages; page++) {
    const offset = page * limit
    let files: PrintfulFileListItem[]
    try {
      files = await listPrintfulFilesPage(client, offset, limit)
    } catch (e) {
      log?.(
        `Printful file library scan stopped at offset ${offset}: ${
          e instanceof Error ? e.message : String(e)
        }`
      )
      break
    }
    if (!files.length) break
    for (const f of files) {
      if (fileMatchesMugProduct(f, opts.title, opts.handle, opts.phrase)) {
        matches.push(f)
      }
    }
    if (files.length < limit) break
  }

  if (!matches.length) return undefined

  matches.sort((a, b) => a.id - b.id)
  const chosen = matches[0]
  const resolved = await resolveFullPrintfulFileUrlById(client, chosen.id, log)
  if (!resolved) return undefined
  log?.(
    `Discovered design source from file library: id=${chosen.id} filename=${chosen.filename || "?"}`
  )
  return {
    fileId: chosen.id,
    url: resolved.url,
    width: resolved.width,
    height: resolved.height,
  }
}

async function resolveDesignFileFromId(
  client: PrintfulApiClient,
  fileId: number,
  log?: (m: string) => void
): Promise<{ url: string; width?: number; height?: number } | undefined> {
  const resolved = await resolveFullPrintfulFileUrlById(client, fileId, log)
  if (!resolved) return undefined
  try {
    const detail = await client.get<{ result?: PrintfulFileListItem }>(`/files/${fileId}`)
    const file = detail?.result ?? (detail as PrintfulFileListItem)
    if (file.filename && isWrapListItem(file)) {
      log?.(`Refusing wrap file id=${fileId} (${file.filename}) in metadata`)
      return undefined
    }
  } catch {
    /* ignore */
  }
  return resolved
}

async function ensureFullResolutionSource(
  client: PrintfulApiClient,
  opts: {
    url: string
    fileId?: number
    log?: (m: string) => void
  }
): Promise<{ url: string; fileId?: number; width?: number; height?: number }> {
  const log = opts.log
  if (opts.fileId) {
    const fromId = await resolveDesignFileFromId(client, opts.fileId, log)
    if (fromId) {
      return { url: fromId.url, fileId: opts.fileId, width: fromId.width, height: fromId.height }
    }
  }
  if (isLikelyPrintfulPreviewUrl(opts.url)) {
    log?.(`source URL looks like a preview — need designSourceFileId to resolve full file`)
  }
  const head = await fetch(opts.url, { method: "HEAD" }).catch(() => null)
  if (head?.ok) {
    const w = head.headers.get("x-amz-meta-width") || head.headers.get("width")
    log?.(`Using design URL (HEAD ok)${w ? ` width=${w}` : ""}`)
  }
  const buf = await fetch(opts.url).then((r) => r.arrayBuffer()).catch(() => null)
  if (buf) {
    const { width, height } = await imageDimensions(Buffer.from(buf))
    return { url: opts.url, fileId: opts.fileId, width, height }
  }
  return { url: opts.url, fileId: opts.fileId }
}

export async function resolveMugDesignSource(
  client: PrintfulApiClient,
  opts: {
    medusaProductId: string
    title: string
    handle: string
    phrase?: string
    metadata?: Record<string, unknown>
    sourceUrlOverride?: string
    log?: (m: string) => void
  }
): Promise<MugDesignSourceResolution | undefined> {
  const log = opts.log
  const meta = readDesignSourceFromMetadata(opts.metadata)

  if (opts.sourceUrlOverride?.trim()) {
    const overrideUrl = opts.sourceUrlOverride.trim()
    log?.(`Mug design source: job override for ${opts.medusaProductId}`)
    const full = await ensureFullResolutionSource(client, {
      url: overrideUrl,
      fileId: meta.fileId,
      log,
    })
    return {
      url: full.url,
      fileId: full.fileId ?? meta.fileId,
      sourceWidth: full.width,
      sourceHeight: full.height,
      source: "sourceUrls_override",
      backfillMetadata: {
        designSourceUrl: full.url,
        ...(full.fileId != null ? { designSourceFileId: full.fileId } : {}),
      },
    }
  }

  if (meta.fileId) {
    const fromId = await resolveDesignFileFromId(client, meta.fileId, log)
    if (fromId) {
      log?.(`Mug design source: metadata.${DESIGN_SOURCE_FILE_ID_META}=${meta.fileId}`)
      return {
        url: fromId.url,
        fileId: meta.fileId,
        sourceWidth: fromId.width,
        sourceHeight: fromId.height,
        source: "metadata_file_id",
      }
    }
  }

  if (meta.url && !isLikelyMugWrapAssetUrl(meta.url)) {
    log?.(`Mug design source: metadata.${DESIGN_SOURCE_URL_META}`)
    const full = await ensureFullResolutionSource(client, {
      url: meta.url,
      fileId: meta.fileId,
      log,
    })
    return {
      url: full.url,
      fileId: full.fileId ?? meta.fileId,
      sourceWidth: full.width,
      sourceHeight: full.height,
      source: "metadata_url",
    }
  }

  const discovered = await discoverOriginalDesignFileFromLibrary(client, {
    title: opts.title,
    handle: opts.handle,
    phrase: opts.phrase,
    log,
  })
  if (discovered) {
    return {
      url: discovered.url,
      fileId: discovered.fileId,
      sourceWidth: discovered.width,
      sourceHeight: discovered.height,
      source: "printful_file_library",
      backfillMetadata: {
        designSourceFileId: discovered.fileId,
        designSourceUrl: discovered.url,
      },
    }
  }

  log?.(
    `No mug design source for ${opts.handle} — set metadata ${DESIGN_SOURCE_FILE_ID_META} or sourceUrls[productId]`
  )
  return undefined
}

export function resolveSourceUrlFromMap(
  map: Record<string, string> | undefined,
  product: { id: string; handle: string }
): string | undefined {
  if (!map) return undefined
  if (map[product.id]) return map[product.id]
  if (map[product.handle]) return map[product.handle]
  const handleKey = Object.keys(map).find(
    (k) => k.toLowerCase() === product.handle.toLowerCase()
  )
  return handleKey ? map[handleKey] : undefined
}
