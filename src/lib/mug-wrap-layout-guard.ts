import sharp from "sharp"
import type { MugWrapDimensions } from "./mug-wrap-composite"

export const MUG_WRAP_MIN_INK_HEIGHT_RATIO = 0.6
export const MUG_WRAP_MAX_INK_CLUSTERS_PER_HALF = 1

export type MugWrapLayoutValidation = {
  ok: boolean
  reason?: string
  leftInkHeight: number
  rightInkHeight: number
  leftClusters: number
  rightClusters: number
}

const INK_ALPHA_THRESHOLD = 28

function isInkPixel(r: number, g: number, b: number, a: number): boolean {
  if (a < INK_ALPHA_THRESHOLD) return false
  if (a < 250 && r > 245 && g > 245 && b > 245) return false
  return true
}

/** Count 4-connected ink components in a binary mask (width × height row-major). */
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
        const neighbors = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ]
        for (const [nx, ny] of neighbors) {
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

function analyzeHalf(
  rgba: Buffer,
  fullWidth: number,
  height: number,
  xStart: number,
  xEnd: number
): { inkHeight: number; clusters: number } {
  const halfWidth = xEnd - xStart
  const mask = new Uint8Array(halfWidth * height)
  let minY = height
  let maxY = -1

  for (let y = 0; y < height; y++) {
    for (let x = xStart; x < xEnd; x++) {
      const o = (y * fullWidth + x) * 4
      const ink = isInkPixel(rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3])
      if (!ink) continue
      mask[y * halfWidth + (x - xStart)] = 1
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  const inkHeight = maxY >= minY ? maxY - minY + 1 : 0
  const clusters = countInkClusters(mask, halfWidth, height)
  return { inkHeight, clusters }
}

/**
 * Validate a composited mug wrap: each half should have one large ink panel
 * (PR #14 layout). Rejects nested/tiny duplicate art (PR #15/#16 regressions).
 */
export async function validateMugWrapLayout(
  wrapPng: Buffer,
  dims: MugWrapDimensions
): Promise<MugWrapLayoutValidation> {
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
      leftInkHeight: 0,
      rightInkHeight: 0,
      leftClusters: 0,
      rightClusters: 0,
    }
  }

  const mid = Math.floor(width / 2)
  const left = analyzeHalf(data, width, height, 0, mid)
  const right = analyzeHalf(data, width, height, mid, width)
  const minInkHeight = Math.round(dims.areaHeight * MUG_WRAP_MIN_INK_HEIGHT_RATIO)

  if (left.clusters > MUG_WRAP_MAX_INK_CLUSTERS_PER_HALF) {
    return {
      ok: false,
      reason: `left half has ${left.clusters} ink clusters (max ${MUG_WRAP_MAX_INK_CLUSTERS_PER_HALF})`,
      leftInkHeight: left.inkHeight,
      rightInkHeight: right.inkHeight,
      leftClusters: left.clusters,
      rightClusters: right.clusters,
    }
  }
  if (right.clusters > MUG_WRAP_MAX_INK_CLUSTERS_PER_HALF) {
    return {
      ok: false,
      reason: `right half has ${right.clusters} ink clusters (max ${MUG_WRAP_MAX_INK_CLUSTERS_PER_HALF})`,
      leftInkHeight: left.inkHeight,
      rightInkHeight: right.inkHeight,
      leftClusters: left.clusters,
      rightClusters: right.clusters,
    }
  }
  if (left.inkHeight < minInkHeight) {
    return {
      ok: false,
      reason: `left ink height ${left.inkHeight}px < ${minInkHeight}px (${MUG_WRAP_MIN_INK_HEIGHT_RATIO * 100}% of wrap)`,
      leftInkHeight: left.inkHeight,
      rightInkHeight: right.inkHeight,
      leftClusters: left.clusters,
      rightClusters: right.clusters,
    }
  }
  if (right.inkHeight < minInkHeight) {
    return {
      ok: false,
      reason: `right ink height ${right.inkHeight}px < ${minInkHeight}px (${MUG_WRAP_MIN_INK_HEIGHT_RATIO * 100}% of wrap)`,
      leftInkHeight: left.inkHeight,
      rightInkHeight: right.inkHeight,
      leftClusters: left.clusters,
      rightClusters: right.clusters,
    }
  }

  const totalClusters = left.clusters + right.clusters
  if (totalClusters > 2) {
    return {
      ok: false,
      reason: `wrap has ${totalClusters} ink clusters (max 2)`,
      leftInkHeight: left.inkHeight,
      rightInkHeight: right.inkHeight,
      leftClusters: left.clusters,
      rightClusters: right.clusters,
    }
  }

  return {
    ok: true,
    leftInkHeight: left.inkHeight,
    rightInkHeight: right.inkHeight,
    leftClusters: left.clusters,
    rightClusters: right.clusters,
  }
}

export class MugWrapLayoutError extends Error {
  readonly validation: MugWrapLayoutValidation

  constructor(validation: MugWrapLayoutValidation) {
    super(validation.reason || "Mug wrap layout validation failed")
    this.name = "MugWrapLayoutError"
    this.validation = validation
  }
}
