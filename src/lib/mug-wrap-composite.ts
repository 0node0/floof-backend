import sharp from "sharp"

export type MugWrapDimensions = {
  areaWidth: number
  areaHeight: number
}

export const MUG_WRAP_HALF_PANEL_FILL_RATIO = 0.85

/** Full-bleed position for a pre-composited wrap PNG. */
export function buildMugWrapFullBleedPosition(
  areaW: number,
  areaH: number
): Record<string, number> {
  return {
    area_width: areaW,
    area_height: areaH,
    width: areaW,
    height: areaH,
    left: 0,
    top: 0,
  }
}

/** Panel centers along the sublimation wrap (front ≈ ¼, back ≈ ¾). */
export function mugWrapPanelCenters(areaWidth: number): { front: number; back: number } {
  return {
    front: Math.round(areaWidth / 4),
    back: Math.round((areaWidth * 3) / 4),
  }
}

export function mugWrapHalfPanelBox(
  dims: MugWrapDimensions,
  fillRatio = MUG_WRAP_HALF_PANEL_FILL_RATIO
): { maxWidth: number; maxHeight: number } {
  return {
    maxWidth: Math.round((dims.areaWidth / 2) * fillRatio),
    maxHeight: Math.round(dims.areaHeight * fillRatio),
  }
}

/** Scale design to fit inside ~85% of each half-panel (width or height binding). */
export function computeMugWrapArtSize(
  dims: MugWrapDimensions,
  designWidth: number,
  designHeight: number,
  fillRatio = MUG_WRAP_HALF_PANEL_FILL_RATIO
): { artWidth: number; artHeight: number } {
  const dw = Math.max(1, designWidth)
  const dh = Math.max(1, designHeight)
  const { maxWidth, maxHeight } = mugWrapHalfPanelBox(dims, fillRatio)
  const scale = Math.min(maxWidth / dw, maxHeight / dh)
  return {
    artWidth: Math.max(1, Math.round(dw * scale)),
    artHeight: Math.max(1, Math.round(dh * scale)),
  }
}

/** @deprecated use computeMugWrapArtSize — square legacy helper for tests */
export function mugWrapArtPixelSize(
  areaWidth: number,
  areaHeight: number,
  widthRatio = 0.36
): number {
  const width = Math.round(areaWidth * widthRatio)
  const height = Math.round(Math.min(width, areaHeight * 0.92))
  return Math.min(width, height)
}

export type MugWrapCompositePlan = {
  areaWidth: number
  areaHeight: number
  artWidth: number
  artHeight: number
  top: number
  frontLeft: number
  backLeft: number
  frontCenterX: number
  backCenterX: number
  halfPanelFillRatio: number
}

export function planMugWrapComposite(
  dims: MugWrapDimensions,
  designWidth = 1000,
  designHeight = 1000,
  fillRatio = MUG_WRAP_HALF_PANEL_FILL_RATIO
): MugWrapCompositePlan {
  const { areaWidth, areaHeight } = dims
  const { artWidth, artHeight } = computeMugWrapArtSize(
    dims,
    designWidth,
    designHeight,
    fillRatio
  )
  const centers = mugWrapPanelCenters(areaWidth)
  const top = Math.round((areaHeight - artHeight) / 2)
  const frontLeft = centers.front - Math.round(artWidth / 2)
  const backLeft = centers.back - Math.round(artWidth / 2)
  return {
    areaWidth,
    areaHeight,
    artWidth,
    artHeight,
    top,
    frontLeft,
    backLeft,
    frontCenterX: centers.front,
    backCenterX: centers.back,
    halfPanelFillRatio: fillRatio,
  }
}

/**
 * Composite the design twice on the wrap (front at ¼, back at ¾).
 * Both panels use the same orientation — no mirroring (flat sublimation wrap).
 */
export async function compositeMugWrapPng(
  designPng: Buffer,
  dims: MugWrapDimensions,
  fillRatio = MUG_WRAP_HALF_PANEL_FILL_RATIO
): Promise<Buffer> {
  const { areaWidth, areaHeight } = dims
  const meta = await sharp(designPng).metadata()
  const designWidth = meta.width || 1
  const designHeight = meta.height || 1
  const { artWidth, artHeight, top, frontLeft, backLeft } = planMugWrapComposite(
    dims,
    designWidth,
    designHeight,
    fillRatio
  )

  const resized = await sharp(designPng)
    .resize(artWidth, artHeight, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()

  return sharp({
    create: {
      width: areaWidth,
      height: areaHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: resized, left: frontLeft, top },
      { input: resized, left: backLeft, top },
    ])
    .png()
    .toBuffer()
}

export function readMugWrapDimensionsFromPosition(
  position: Record<string, number>
): MugWrapDimensions {
  const areaWidth = position.area_width || 2700
  const areaHeight = position.area_height || 1050
  return { areaWidth, areaHeight }
}
