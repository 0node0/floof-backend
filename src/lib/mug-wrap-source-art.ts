import sharp from "sharp"
import type PrintfulApiClient from "../modules/printful/client"
import {
  type MugWrapDimensions,
  planMugWrapComposite,
} from "./mug-wrap-composite"
import {
  isEphemeralFloofDesignUrl,
  pickDurableUrlFromFile,
  resolveDurablePrintfulDesignUrl,
  type SyncVariantFile,
} from "./printful-design-url"

/** Full mug wrap (e.g. 2700×1050) — not single-sided artwork. */
export function isMugWrapImageDimensions(width: number, height: number): boolean {
  if (width < 500 || height < 200) return false
  const ratio = width / height
  return ratio >= 2.2 && width >= height * 2
}

export function isLikelyMugWrapAssetUrl(url: string): boolean {
  return /mug-wrap-\d+x\d+/i.test(url) || /wrap.*2700/i.test(url)
}

async function imageDimensions(png: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(png).metadata()
  return { width: meta.width || 0, height: meta.height || 0 }
}

/**
 * Crop the front-panel artwork from an existing wrap PNG (PR #14 layout).
 */
export async function extractFrontPanelArtFromWrap(
  wrapPng: Buffer,
  dims: MugWrapDimensions,
  widthRatio = 0.36
): Promise<Buffer> {
  const plan = planMugWrapComposite(dims, widthRatio)
  const { width, height } = await imageDimensions(wrapPng)
  if (width < plan.areaWidth || height < plan.areaHeight) {
    const scale = Math.min(width / plan.areaWidth, height / plan.areaHeight)
    const resized = await sharp(wrapPng)
      .resize(Math.round(plan.areaWidth * scale), Math.round(plan.areaHeight * scale))
      .png()
      .toBuffer()
    return extractFrontPanelArtFromWrap(resized, dims, widthRatio)
  }

  const left = Math.max(0, Math.min(plan.frontLeft, width - plan.artSize))
  const top = Math.max(0, Math.min(plan.top, height - plan.artSize))
  return sharp(wrapPng)
    .extract({ left, top, width: plan.artSize, height: plan.artSize })
    .png()
    .toBuffer()
}

/**
 * Load PNG bytes for wrap compositing — never feed an existing wrap through the
 * compositor as if it were single-sided art (PR #15 regression).
 */
export async function resolveSingleSidedArtPngForWrap(
  designUrl: string,
  dims: MugWrapDimensions,
  log?: (m: string) => void
): Promise<Buffer> {
  const res = await fetch(designUrl)
  if (!res.ok) {
    throw new Error(`Failed to fetch design (${res.status}): ${designUrl.slice(0, 80)}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const { width, height } = await imageDimensions(buf)
  const wrapBySize = isMugWrapImageDimensions(width, height)
  const wrapByUrl = isLikelyMugWrapAssetUrl(designUrl)

  if (!wrapBySize && !wrapByUrl) {
    return buf
  }

  log?.(
    `Design source is a mug wrap (${width}×${height}) — extracting front-panel art for re-composite`
  )
  return extractFrontPanelArtFromWrap(buf, dims)
}

function collectAllFileUrls(syncVariants: Array<{ files?: SyncVariantFile[] }>): string[] {
  const urls: string[] = []
  for (const sv of syncVariants) {
    for (const f of sv.files || []) {
      for (const u of [f.preview_url, f.thumbnail_url, f.url]) {
        if (u && !urls.includes(u)) urls.push(u)
      }
    }
  }
  return urls
}

async function pickBestSingleSidedUrl(
  urls: string[],
  dims: MugWrapDimensions,
  log?: (m: string) => void
): Promise<string | undefined> {
  let wrapFallback: string | undefined
  for (const url of urls) {
    if (isEphemeralFloofDesignUrl(url)) continue
    if (isLikelyMugWrapAssetUrl(url)) {
      wrapFallback = url
      continue
    }
    try {
      const res = await fetch(url)
      if (!res.ok) continue
      const buf = Buffer.from(await res.arrayBuffer())
      const { width, height } = await imageDimensions(buf)
      if (isMugWrapImageDimensions(width, height)) {
        wrapFallback = url
        log?.(`Skip wrap-shaped design URL ${width}×${height}`)
        continue
      }
      return url
    } catch {
      continue
    }
  }
  return wrapFallback
}

/** Resolve artwork for mug wrap — prefers single-sided PNG, not sync wrap file. */
export async function resolveMugWrapSourceDesignUrl(
  client: PrintfulApiClient,
  syncVariants: Array<{ files?: SyncVariantFile[] }>,
  dims: MugWrapDimensions,
  opts?: {
    thumbnailUrl?: string
    fallbackUrls?: string[]
    log?: (m: string) => void
  }
): Promise<string | undefined> {
  const log = opts?.log
  const candidates = [
    ...collectAllFileUrls(syncVariants),
    ...(opts?.fallbackUrls || []),
    opts?.thumbnailUrl || "",
  ].filter(Boolean)

  const best = await pickBestSingleSidedUrl(candidates, dims, log)
  if (best) {
    log?.(`Mug wrap source URL: ${best.slice(0, 80)}…`)
    return best
  }

  return resolveDurablePrintfulDesignUrl(client, syncVariants, {
    thumbnailUrl: opts?.thumbnailUrl,
    fallbackUrls: opts?.fallbackUrls,
    log,
  })
}
