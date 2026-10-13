import sharp from "sharp"
import type { MugWrapCompositePlan, MugWrapDimensions } from "./mug-wrap-composite"

/** Ink union bbox must reach at least this fraction of the planned art size. */
export const MUG_WRAP_MIN_FIT_RATIO = 0.7
/** How close the ink bbox center must be to the panel center (fraction of half-panel width). */
export const MUG_WRAP_CENTER_TOLERANCE_RATIO = 0.08

export type MugWrapLayoutValidation = {
  ok: boolean
  reason?: string
  leftInkWidth: number
  leftInkHeight: number
  rightInkWidth: number
  rightInkHeight: number
  halvesIdentical: boolean
  centerSeamInk: boolean
  expectedArtWidth: number
  expectedArtHeight: number
}

const INK_ALPHA_THRESHOLD = 28

export function isInkPixel(r: number, g: number, b: number, a: number): boolean {
  if (a < INK_ALPHA_THRESHOLD) return false
  if (a < 250 && r > 245 && g > 245 && b > 245) return false
  return true
}

type HalfInkBbox = {
  inkWidth: number
  inkHeight: number
  bboxCenterX: number
  bboxCenterY: number
  cropRgba: Buffer | null
  cropWidth: number
  cropHeight: number
}

export function analyzeHalfInkBbox(
  rgba: Buffer,
  fullWidth: number,
  height: number,
  xStart: number,
  xEnd: number
): HalfInkBbox {
  let minX = fullWidth
  let maxX = -1
  let minY = height
  let maxY = -1

  for (let y = 0; y < height; y++) {
    for (let x = xStart; x < xEnd; x++) {
      const o = (y * fullWidth + x) * 4
      const ink = isInkPixel(rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3])
      if (!ink) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  const inkWidth = maxX >= minX ? maxX - minX + 1 : 0
  const inkHeight = maxY >= minY ? maxY - minY + 1 : 0

  if (inkWidth <= 0 || inkHeight <= 0) {
    return {
      inkWidth: 0,
      inkHeight: 0,
      bboxCenterX: 0,
      bboxCenterY: 0,
      cropRgba: null,
      cropWidth: 0,
      cropHeight: 0,
    }
  }

  const bboxCenterX = (minX + maxX) / 2
  const bboxCenterY = (minY + maxY) / 2
  const cropWidth = inkWidth
  const cropHeight = inkHeight
  const crop = Buffer.alloc(cropWidth * cropHeight * 4)
  for (let y = 0; y < cropHeight; y++) {
    for (let x = 0; x < cropWidth; x++) {
      const srcX = minX + x
      const srcY = minY + y
      const so = (srcY * fullWidth + srcX) * 4
      const di = (y * cropWidth + x) * 4
      crop[di] = rgba[so]
      crop[di + 1] = rgba[so + 1]
      crop[di + 2] = rgba[so + 2]
      crop[di + 3] = rgba[so + 3]
    }
  }

  return {
    inkWidth,
    inkHeight,
    bboxCenterX,
    bboxCenterY,
    cropRgba: crop,
    cropWidth,
    cropHeight,
  }
}

export function cropsPixelIdentical(a: HalfInkBbox, b: HalfInkBbox): boolean {
  if (!a.cropRgba || !b.cropRgba) return false
  if (a.cropWidth !== b.cropWidth || a.cropHeight !== b.cropHeight) return false
  return a.cropRgba.equals(b.cropRgba)
}

export function inkCrossesCenterSeam(
  rgba: Buffer,
  fullWidth: number,
  height: number,
  mid: number
): boolean {
  const seamColumns = [mid - 1, mid].filter((x) => x >= 0 && x < fullWidth)
  for (let y = 0; y < height; y++) {
    for (const x of seamColumns) {
      const o = (y * fullWidth + x) * 4
      if (isInkPixel(rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3])) {
        return true
      }
    }
  }
  return false
}

export function isBboxCenteredOnPanel(
  bboxCenterX: number,
  panelCenterX: number,
  halfPanelWidth: number,
  toleranceRatio = MUG_WRAP_CENTER_TOLERANCE_RATIO
): boolean {
  const tolerance = halfPanelWidth * toleranceRatio
  return Math.abs(bboxCenterX - panelCenterX) <= tolerance
}

export async function validateMugWrapLayout(
  wrapPng: Buffer,
  dims: MugWrapDimensions,
  plan: MugWrapCompositePlan
): Promise<MugWrapLayoutValidation> {
  const base = {
    expectedArtWidth: plan.artWidth,
    expectedArtHeight: plan.artHeight,
    leftInkWidth: 0,
    leftInkHeight: 0,
    rightInkWidth: 0,
    rightInkHeight: 0,
    halvesIdentical: false,
    centerSeamInk: false,
  }

  const { data, info } = await sharp(wrapPng)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const width = info.width
  const height = info.height
  if (width < dims.areaWidth * 0.9 || height < dims.areaHeight * 0.9) {
    return {
      ok: false,
      reason: `wrap size ${width}×${height} below expected ${dims.areaWidth}×${dims.areaHeight}`,
      ...base,
    }
  }

  const mid = Math.floor(width / 2)
  const halfPanelWidth = mid
  const left = analyzeHalfInkBbox(data, width, height, 0, mid)
  const right = analyzeHalfInkBbox(data, width, height, mid, width)
  const halvesIdentical = cropsPixelIdentical(left, right)
  const centerSeamInk = inkCrossesCenterSeam(data, width, height, mid)

  const result: MugWrapLayoutValidation = {
    ...base,
    leftInkWidth: left.inkWidth,
    leftInkHeight: left.inkHeight,
    rightInkWidth: right.inkWidth,
    rightInkHeight: right.inkHeight,
    halvesIdentical,
    centerSeamInk,
    ok: false,
  }

  const minW = Math.round(plan.artWidth * MUG_WRAP_MIN_FIT_RATIO)
  const minH = Math.round(plan.artHeight * MUG_WRAP_MIN_FIT_RATIO)

  if (centerSeamInk) {
    result.reason = "ink crosses the wrap center seam"
    return result
  }
  if (left.inkWidth < minW || left.inkHeight < minH) {
    result.reason = `left artwork bbox ${left.inkWidth}×${left.inkHeight} below planned fit (min ${minW}×${minH}, ${MUG_WRAP_MIN_FIT_RATIO * 100}% of ${plan.artWidth}×${plan.artHeight})`
    return result
  }
  if (right.inkWidth < minW || right.inkHeight < minH) {
    result.reason = `right artwork bbox ${right.inkWidth}×${right.inkHeight} below planned fit (min ${minW}×${minH})`
    return result
  }
  if (
    !isBboxCenteredOnPanel(left.bboxCenterX, plan.frontCenterX, halfPanelWidth)
  ) {
    result.reason = `left artwork bbox not centered on front panel (center x=${left.bboxCenterX.toFixed(1)}, expected ≈${plan.frontCenterX})`
    return result
  }
  if (!isBboxCenteredOnPanel(right.bboxCenterX, plan.backCenterX, halfPanelWidth)) {
    result.reason = `right artwork bbox not centered on back panel (center x=${right.bboxCenterX.toFixed(1)}, expected ≈${plan.backCenterX})`
    return result
  }
  if (!halvesIdentical) {
    result.reason =
      "left and right wrap halves are not pixel-identical (check mirroring or duplicate art)"
    return result
  }

  result.ok = true
  return result
}

export class MugWrapLayoutError extends Error {
  readonly validation: MugWrapLayoutValidation

  constructor(validation: MugWrapLayoutValidation) {
    super(validation.reason || "Mug wrap layout validation failed")
    this.name = "MugWrapLayoutError"
    this.validation = validation
  }
}
