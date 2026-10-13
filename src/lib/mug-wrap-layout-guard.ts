import sharp from "sharp"
import type { MugWrapCompositePlan, MugWrapDimensions } from "./mug-wrap-composite"

export const MUG_WRAP_MAX_INK_CLUSTERS_PER_HALF = 1
/** Ink bbox must reach at least this fraction of the planned art size after fit. */
export const MUG_WRAP_INK_SIZE_TOLERANCE = 0.88

export type MugWrapLayoutValidation = {
  ok: boolean
  reason?: string
  leftInkWidth: number
  leftInkHeight: number
  rightInkWidth: number
  rightInkHeight: number
  leftClusters: number
  rightClusters: number
  halvesIdentical: boolean
  expectedArtWidth: number
  expectedArtHeight: number
}

const INK_ALPHA_THRESHOLD = 28

function isInkPixel(r: number, g: number, b: number, a: number): boolean {
  if (a < INK_ALPHA_THRESHOLD) return false
  if (a < 250 && r > 245 && g > 245 && b > 245) return false
  return true
}

function countInkClusters(mask: Uint8Array, width: number, height: number): number {
  const visited = new Uint8Array(mask.length)
  let clusters = 0
  const stack: number[] = []

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!mask[i] || visited[i]) continue
      clusters++
      stack.push(i)
      visited[i] = 1
      while (stack.length) {
        const cur = stack.pop()!
        const cy = Math.floor(cur / width)
        const cx = cur - cy * width
        for (const [nx, ny] of [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ]) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const ni = ny * width + nx
          if (!mask[ni] || visited[ni]) continue
          visited[ni] = 1
          stack.push(ni)
        }
      }
    }
  }
  return clusters
}

type HalfInkAnalysis = {
  inkWidth: number
  inkHeight: number
  clusters: number
  cropRgba: Buffer | null
  cropWidth: number
  cropHeight: number
}

function analyzeHalf(
  rgba: Buffer,
  fullWidth: number,
  height: number,
  xStart: number,
  xEnd: number
): HalfInkAnalysis {
  const halfWidth = xEnd - xStart
  const mask = new Uint8Array(halfWidth * height)
  let minX = halfWidth
  let maxX = -1
  let minY = height
  let maxY = -1

  for (let y = 0; y < height; y++) {
    for (let x = xStart; x < xEnd; x++) {
      const o = (y * fullWidth + x) * 4
      const ink = isInkPixel(rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3])
      if (!ink) continue
      const lx = x - xStart
      mask[y * halfWidth + lx] = 1
      if (lx < minX) minX = lx
      if (lx > maxX) maxX = lx
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  const inkWidth = maxX >= minX ? maxX - minX + 1 : 0
  const inkHeight = maxY >= minY ? maxY - minY + 1 : 0
  const clusters = countInkClusters(mask, halfWidth, height)

  if (inkWidth <= 0 || inkHeight <= 0) {
    return {
      inkWidth: 0,
      inkHeight: 0,
      clusters,
      cropRgba: null,
      cropWidth: 0,
      cropHeight: 0,
    }
  }

  const cropWidth = inkWidth
  const cropHeight = inkHeight
  const crop = Buffer.alloc(cropWidth * cropHeight * 4)
  for (let y = 0; y < cropHeight; y++) {
    for (let x = 0; x < cropWidth; x++) {
      const srcX = xStart + minX + x
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
    clusters,
    cropRgba: crop,
    cropWidth,
    cropHeight,
  }
}

function cropsPixelIdentical(a: HalfInkAnalysis, b: HalfInkAnalysis): boolean {
  if (!a.cropRgba || !b.cropRgba) return false
  if (a.cropWidth !== b.cropWidth || a.cropHeight !== b.cropHeight) return false
  return a.cropRgba.equals(b.cropRgba)
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
    leftClusters: 0,
    rightClusters: 0,
    halvesIdentical: false,
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
  const left = analyzeHalf(data, width, height, 0, mid)
  const right = analyzeHalf(data, width, height, mid, width)
  const halvesIdentical = cropsPixelIdentical(left, right)

  const result: MugWrapLayoutValidation = {
    ...base,
    leftInkWidth: left.inkWidth,
    leftInkHeight: left.inkHeight,
    rightInkWidth: right.inkWidth,
    rightInkHeight: right.inkHeight,
    leftClusters: left.clusters,
    rightClusters: right.clusters,
    halvesIdentical,
    ok: false,
  }

  const minW = Math.round(plan.artWidth * MUG_WRAP_INK_SIZE_TOLERANCE)
  const minH = Math.round(plan.artHeight * MUG_WRAP_INK_SIZE_TOLERANCE)

  if (left.clusters > MUG_WRAP_MAX_INK_CLUSTERS_PER_HALF) {
    result.reason = `left half has ${left.clusters} ink clusters (max ${MUG_WRAP_MAX_INK_CLUSTERS_PER_HALF})`
    return result
  }
  if (right.clusters > MUG_WRAP_MAX_INK_CLUSTERS_PER_HALF) {
    result.reason = `right half has ${right.clusters} ink clusters (max ${MUG_WRAP_MAX_INK_CLUSTERS_PER_HALF})`
    return result
  }
  if (left.inkWidth < minW || left.inkHeight < minH) {
    result.reason = `left ink ${left.inkWidth}×${left.inkHeight} below planned ${plan.artWidth}×${plan.artHeight} (min ${minW}×${minH})`
    return result
  }
  if (right.inkWidth < minW || right.inkHeight < minH) {
    result.reason = `right ink ${right.inkWidth}×${right.inkHeight} below planned ${plan.artWidth}×${plan.artHeight} (min ${minW}×${minH})`
    return result
  }
  if (!halvesIdentical) {
    result.reason = "left and right wrap halves are not pixel-identical (check mirroring or duplicate art)"
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
