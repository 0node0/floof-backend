import sharp from "sharp"
import { clampPrintPosition, type ApparelPrintPosition } from "./apparel-placement-layout"
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

export const MOCKUP_REGION_PADDING_FACTOR = 1.3

/** Art box on mockup from 12″×16″ print-file coordinates (no full-frame padding). */
export function computeArtBoxOnMockup(
  imageWidth: number,
  imageHeight: number,
  printPosition: ApparelPrintPosition
): MockupImageRegion {
  const box = clampPrintPosition(printPosition)
  const iw = Math.max(1, imageWidth)
  const ih = Math.max(1, imageHeight)
  return clampExtractRegion(iw, ih, {
    left: (box.left / box.area_width) * iw,
    top: (box.top / box.area_height) * ih,
    width: (box.width / box.area_width) * iw,
    height: (box.height / box.area_height) * ih,
  })
}

/**
 * Validation region: print box mapped from 12×16″ print area onto the mockup, × modest padding (~1.3).
 */
export function computeTightPlacementRegionOnMockup(
  imageWidth: number,
  imageHeight: number,
  printPosition: ApparelPrintPosition,
  paddingFactor = MOCKUP_REGION_PADDING_FACTOR
): MockupImageRegion {
  const art = computeArtBoxOnMockup(imageWidth, imageHeight, printPosition)
  const padW = (art.width * (paddingFactor - 1)) / 2
  const padH = (art.height * (paddingFactor - 1)) / 2
  const iw = Math.max(1, imageWidth)
  const ih = Math.max(1, imageHeight)
  return clampExtractRegion(iw, ih, {
    left: art.left - padW,
    top: art.top - padH,
    width: art.width + padW * 2,
    height: art.height + padH * 2,
  })
}

/** @deprecated use computeTightPlacementRegionOnMockup */
export function computeGenerousPlacementRegionOnMockup(
  imageWidth: number,
  imageHeight: number,
  printPosition: ApparelPrintPosition
): MockupImageRegion {
  return computeTightPlacementRegionOnMockup(imageWidth, imageHeight, printPosition)
}

/** Fraction of validation-region area covered by the art box (when region uses paddingFactor). */
export function expectedArtAreaFractionInRegion(paddingFactor = MOCKUP_REGION_PADDING_FACTOR): number {
  return 1 / (paddingFactor * paddingFactor)
}

/**
 * Minimum in-box diff ratio to count as visible art.
 * Scales with art size on the print file; tuned for prod logs (~1–2.7% left chest, blanks lower).
 */
export function computeInBoxPassThreshold(
  printPosition: ApparelPrintPosition,
  paddingFactor = MOCKUP_REGION_PADDING_FACTOR
): number {
  const box = clampPrintPosition(printPosition)
  const artAreaOnPrintFile =
    (box.width * box.height) / (box.area_width * box.area_height)
  const artInRegion = expectedArtAreaFractionInRegion(paddingFactor)
  const scaled = artAreaOnPrintFile * artInRegion * 0.18
  return Math.max(0.0055, Math.min(0.04, scaled))
}

export function mockupInBoxDiffPasses(
  inBoxRatio: number,
  printPosition: ApparelPrintPosition,
  paddingFactor = MOCKUP_REGION_PADDING_FACTOR
): boolean {
  return inBoxRatio >= computeInBoxPassThreshold(printPosition, paddingFactor)
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

/** @deprecated use mockupInBoxDiffPasses with print position */
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
  passThreshold: number
}> {
  const meta = await sharp(designBuf).metadata()
  const iw = meta.width || 1
  const ih = meta.height || 1
  const region = computeTightPlacementRegionOnMockup(iw, ih, printPosition)
  const passThreshold = computeInBoxPassThreshold(printPosition)

  const [full, inBox] = await Promise.all([
    mockupPixelDifference(designBuf, blankBuf),
    mockupPixelDifferenceInRegion(designBuf, blankBuf, region),
  ])

  const passed = mockupInBoxDiffPasses(inBox.ratio, printPosition)
  return {
    passed,
    fullFrameRatio: full.ratio,
    inBoxRatio: inBox.ratio,
    region,
    passThreshold,
  }
}
