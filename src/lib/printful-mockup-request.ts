import {
  clampPrintPosition,
  type ApparelPrintPosition,
} from "./apparel-placement-layout"
import type PrintfulApiClient from "../modules/printful/client"
import {
  isLikelyPrintfulPreviewUrl,
  resolveFullPrintfulFileUrlById,
} from "./printful-file-url"
import type { MockupPrintPosition } from "./printful-mockup-generator"

/**
 * Printful Mockup Generator: `image_url` is the artwork; `position` places it in the
 * print area (area_width/height = printfile size). See Printful docs § Mockup Generator —
 * "path-to-front-printfile.jpg" with width/height/top/left inside 1800×2400.
 *
 * A mostly-transparent full-area PNG with full-bleed position does not render on mockups.
 */
export type PrintfulMockupFilePayload = {
  placement: string
  image_url: string
  position: MockupPrintPosition
}

export const MOCKUP_ARTWORK_MIN_LONG_EDGE_PX = 1800

export type MockupArtworkDimensions = {
  width?: number
  height?: number
}

/** URL path hint only — Printful may serve full-size art from `_preview.png` URLs. */
export function urlLooksLikePreviewArtworkPath(url: string): boolean {
  return /_preview\.png/i.test(url) || isLikelyPrintfulPreviewUrl(url)
}

/** @deprecated use urlLooksLikePreviewArtworkPath — does not consider pixel dimensions */
export function isPreviewArtworkUrl(url: string): boolean {
  return urlLooksLikePreviewArtworkPath(url)
}

export function artworkLongEdgePx(dimensions?: MockupArtworkDimensions): number {
  const w = dimensions?.width ?? 0
  const h = dimensions?.height ?? 0
  return Math.max(w, h)
}

export function hasKnownArtworkDimensions(dimensions?: MockupArtworkDimensions): boolean {
  const w = dimensions?.width
  const h = dimensions?.height
  return typeof w === "number" && w > 0 && typeof h === "number" && h > 0
}

export function isArtworkLargeEnoughForMockup(dimensions?: MockupArtworkDimensions): boolean {
  return artworkLongEdgePx(dimensions) >= MOCKUP_ARTWORK_MIN_LONG_EDGE_PX
}

/** Reject undersized art; accept large files even when the URL contains `_preview.png`. */
export function rejectArtworkForMockup(
  url: string,
  dimensions?: MockupArtworkDimensions
): string | null {
  if (hasKnownArtworkDimensions(dimensions)) {
    if (!isArtworkLargeEnoughForMockup(dimensions)) {
      return `Artwork too small for mockups (${dimensions!.width}×${dimensions!.height}px; need long edge ≥ ${MOCKUP_ARTWORK_MIN_LONG_EDGE_PX}px)`
    }
    return null
  }
  if (urlLooksLikePreviewArtworkPath(url)) {
    return "Artwork URL looks like a preview and Printful file dimensions are unknown — set designSourceFileId"
  }
  return null
}

export type ResolvedMockupArtwork = {
  url: string
  width?: number
  height?: number
}

export async function resolveArtworkUrlForMockup(
  client: PrintfulApiClient,
  designSourceUrl: string,
  fileId?: number,
  log?: (m: string) => void
): Promise<ResolvedMockupArtwork> {
  let url = designSourceUrl
  let width: number | undefined
  let height: number | undefined

  if (fileId) {
    const resolved = await resolveFullPrintfulFileUrlById(client, fileId, log)
    if (resolved?.url) {
      url = resolved.url
      width = resolved.width
      height = resolved.height
    }
  }

  const rejection = rejectArtworkForMockup(url, { width, height })
  if (rejection) {
    if (fileId && !hasKnownArtworkDimensions({ width, height })) {
      throw new Error(
        `Design source file id=${fileId} could not be resolved with dimensions for mockups`
      )
    }
    throw new Error(rejection)
  }

  return { url, width, height }
}

export function buildApparelMockupFilePayload(opts: {
  placement: string
  designSourceUrl: string
  printPosition: ApparelPrintPosition
  artworkWidth?: number
  artworkHeight?: number
}): PrintfulMockupFilePayload {
  const rejection = rejectArtworkForMockup(opts.designSourceUrl, {
    width: opts.artworkWidth,
    height: opts.artworkHeight,
  })
  if (rejection) {
    throw new Error(rejection)
  }

  const position = clampPrintPosition(opts.printPosition)
  return {
    placement: opts.placement,
    image_url: opts.designSourceUrl,
    position: {
      ...position,
      limit_to_print_area: true,
    },
  }
}

export function mockupCreateOptionsForPlacement(placement: string): string[] | undefined {
  if (placement.toLowerCase() === "back") return ["Back"]
  return undefined
}

/** @deprecated for mockup API — full-bleed composited PNGs do not render; use buildApparelMockupFilePayload */
export function isFullBleedMockupPosition(
  position: ApparelPrintPosition | MockupPrintPosition
): boolean {
  const left = Number(position.left)
  const top = Number(position.top)
  const width = Number(position.width)
  const height = Number(position.height)
  const areaW = Number(position.area_width)
  const areaH = Number(position.area_height)
  return left === 0 && top === 0 && width === areaW && height === areaH
}
