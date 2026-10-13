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

export function isPreviewArtworkUrl(url: string): boolean {
  return /_preview\.png/i.test(url) || isLikelyPrintfulPreviewUrl(url)
}

/** Mockup generator needs full-resolution art, not Printful `_preview.png` CDN paths. */
export async function resolveArtworkUrlForMockup(
  client: PrintfulApiClient,
  designSourceUrl: string,
  fileId?: number,
  log?: (m: string) => void
): Promise<string> {
  if (fileId) {
    const resolved = await resolveFullPrintfulFileUrlById(client, fileId, log)
    if (resolved?.url) return resolved.url
  }
  if (!isPreviewArtworkUrl(designSourceUrl)) {
    return designSourceUrl
  }
  if (fileId) {
    throw new Error(
      `Design source is a preview URL and full file id=${fileId} could not be resolved`
    )
  }
  throw new Error(
    "Design source URL is a Printful preview; set designSourceFileId metadata for full-resolution mockups"
  )
}

export function buildApparelMockupFilePayload(opts: {
  placement: string
  designSourceUrl: string
  printPosition: ApparelPrintPosition
}): PrintfulMockupFilePayload {
  const position = clampPrintPosition(opts.printPosition)
  if (isPreviewArtworkUrl(opts.designSourceUrl)) {
    throw new Error(
      "Refusing preview artwork URL for mockup image_url — resolve full file first"
    )
  }
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
