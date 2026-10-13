import {
  clampPrintPosition,
  type ApparelPrintPosition,
} from "./apparel-placement-layout"
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

export function buildApparelMockupFilePayload(opts: {
  placement: string
  designSourceUrl: string
  printPosition: ApparelPrintPosition
}): PrintfulMockupFilePayload {
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
