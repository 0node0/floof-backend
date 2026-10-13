import sharp from "sharp"

export type MugWrapDimensions = {
  areaWidth: number
  areaHeight: number
}

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

export function mugWrapArtPixelSize(
  areaWidth: number,
  areaHeight: number,
  widthRatio = 0.36
): number {
  const width = Math.round(areaWidth * widthRatio)
  const height = Math.round(Math.min(width, areaHeight * 0.92))
  return Math.min(width, height)
}

/**
 * Composite the design twice on the wrap: normal on the front panel, horizontally
 * mirrored on the back panel (standard POD mug wrap).
 */
export async function compositeMugWrapPng(
  designPng: Buffer,
  dims: MugWrapDimensions,
  widthRatio = 0.36
): Promise<Buffer> {
  const { areaWidth, areaHeight } = dims
  const artSize = mugWrapArtPixelSize(areaWidth, areaHeight, widthRatio)
  const centers = mugWrapPanelCenters(areaWidth)

  const resized = await sharp(designPng)
    .resize(artSize, artSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()

  const mirrored = await sharp(resized).flop().toBuffer()

  const top = Math.round((areaHeight - artSize) / 2)
  const frontLeft = centers.front - Math.round(artSize / 2)
  const backLeft = centers.back - Math.round(artSize / 2)

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
      { input: mirrored, left: backLeft, top },
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
