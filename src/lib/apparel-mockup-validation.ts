import sharp from "sharp"
import {
  clampPrintPosition,
  type ApparelPrintPosition,
} from "./apparel-placement-layout"
import { clampExtractRegion } from "./apparel-mockup-template-fallback"

export type MockupPixelDiff = {
  differingPixels: number
  totalPixels: number
  ratio: number
}

export type MockupImageRegion = {
  left: number
  top: number
  width: number
  height: number
}

/** Map print placement box onto a lifestyle mockup (proportional + generous padding). */
export function computeGenerousPlacementRegionOnMockup(
  imageWidth: number,
  imageHeight: number,
  printPosition: ApparelPrintPosition,
  generousFraction = 0.4
): MockupImageRegion {
  const box = clampPrintPosition(printPosition)
  const iw = Math.max(1, imageWidth)
  const ih = Math.max(1, imageHeight)

  let left = (box.left / box.area_width) * iw
  let top = (box.top / box.area_height) * ih
  let width = (box.width / box.area_width) * iw
  let height = (box.height / box.area_height) * ih

  const padX = Math.max(width * generousFraction, iw * 0.025)
  const padY = Math.max(height * generousFraction, ih * 0.025)

  return clampExtractRegion(iw, ih, {
    left: left - padX,
    top: top - padY,
    width: width + padX * 2,
    height: height + padY * 2,
  })
}

function countPixelDiff(
  a: Buffer,
  b: Buffer,
  channels: number,
  totalPixels: number,
  threshold: number
): number {
  let differing = 0
  for (let i = 0; i < totalPixels; i++) {
    const o = i * channels
    const dr = Math.abs(a[o] - b[o])
    const dg = Math.abs(a[o + 1] - b[o + 1])
    const db = Math.abs(a[o + 2] - b[o + 2])
    if (dr + dg + db > threshold) differing++
  }
  return differing
}

/** Compare two mockup JPEG/PNG buffers; ratio is fraction of pixels that differ noticeably. */
export async function mockupPixelDifference(
  mockupA: Buffer,
  mockupB: Buffer,
  threshold = 18
): Promise<MockupPixelDiff> {
  const size = 256
  const a = await sharp(mockupA)
    .resize(size, size, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer()
  const b = await sharp(mockupB)
    .resize(size, size, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer()
  const channels = 3
  const totalPixels = size * size
  const differing = countPixelDiff(a, b, channels, totalPixels, threshold)
  return {
    differingPixels: differing,
    totalPixels,
    ratio: differing / totalPixels,
  }
}

/** Compare only the expected print region (left chest, centred chest, back, etc.). */
export async function mockupPixelDifferenceInRegion(
  mockupA: Buffer,
  mockupB: Buffer,
  region: MockupImageRegion,
  threshold = 18,
  sampleSize = 128
): Promise<MockupPixelDiff> {
  const meta = await sharp(mockupA).metadata()
  const iw = meta.width || sampleSize
  const ih = meta.height || sampleSize
  const r = clampExtractRegion(iw, ih, region)

  const extract = async (buf: Buffer) =>
    sharp(buf)
      .extract(r)
      .resize(sampleSize, sampleSize, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer()

  const [a, b] = await Promise.all([extract(mockupA), extract(mockupB)])
  const channels = 3
  const totalPixels = sampleSize * sampleSize
  const differing = countPixelDiff(a, b, channels, totalPixels, threshold)
  return {
    differingPixels: differing,
    totalPixels,
    ratio: differing / totalPixels,
  }
}

export async function fetchImageBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch mockup image (${res.status})`)
  }
  return Buffer.from(await res.arrayBuffer())
}

export function mockupShowsDesign(diff: MockupPixelDiff, minRatio = 0.008): boolean {
  return diff.ratio >= minRatio
}

/** In-box diff threshold — small prints are a tiny fraction of the full frame. */
export function mockupShowsDesignInRegion(diff: MockupPixelDiff, minRatio = 0.04): boolean {
  return diff.ratio >= minRatio
}

export async function validateMockupArtVisibility(
  designBuf: Buffer,
  blankBuf: Buffer,
  printPosition: ApparelPrintPosition
): Promise<{
  passed: boolean
  fullFrameRatio: number
  inBoxRatio: number
  region: MockupImageRegion
}> {
  const meta = await sharp(designBuf).metadata()
  const iw = meta.width || 1
  const ih = meta.height || 1
  const region = computeGenerousPlacementRegionOnMockup(iw, ih, printPosition)

  const [full, inBox] = await Promise.all([
    mockupPixelDifference(designBuf, blankBuf),
    mockupPixelDifferenceInRegion(designBuf, blankBuf, region),
  ])

  const passed = mockupShowsDesignInRegion(inBox)
  return {
    passed,
    fullFrameRatio: full.ratio,
    inBoxRatio: inBox.ratio,
    region,
  }
}
