import {
  findPrintfileDimensions,
  printfileIdForPlacement,
  type PrintfileInfo,
  type PrintfilesApiResult,
} from "./printful-mockup-config"

export type ApparelPlacementLayout = "leftChest" | "chestPlusBack" | "centred"

export type ApparelPrintPosition = Record<string, number>

export type ApparelPrintPlacementSpec = {
  placement: string
  syncFileType: string
  position: ApparelPrintPosition
}

export type ApparelPlacementInches = {
  left: number
  top: number
  width: number
  height: number
  areaWidth: number
  areaHeight: number
}

export type ApparelPlacementPlanEntry = ApparelPrintPlacementSpec & {
  dpi: number
  inches: ApparelPlacementInches
}

export type ApparelLayoutPlan = {
  layout: ApparelPlacementLayout
  isHoodie: boolean
  placements: ApparelPrintPlacementSpec[]
  planned: ApparelPlacementPlanEntry[]
}

/** Infer DPI from Printful print-area pixel dimensions (12″×16″ @ 150 or 6″×8″ @ 300). */
export function resolvePrintAreaDpi(areaW: number, areaH: number): number {
  if (areaW <= 0 || areaH <= 0) return 300
  const dpi150w = areaW / 12
  const dpi150h = areaH / 16
  if (Math.abs(dpi150w - 150) <= 25 && Math.abs(dpi150h - 150) <= 25) {
    return Math.round((dpi150w + dpi150h) / 2)
  }
  const dpi300w = areaW / 6
  const dpi300h = areaH / 8
  if (Math.abs(dpi300w - 300) <= 40 && Math.abs(dpi300h - 300) <= 40) {
    return Math.round((dpi300w + dpi300h) / 2)
  }
  return Math.round(areaW / 12)
}

export function inchesToPixels(inches: number, dpi: number): number {
  return Math.round(inches * dpi)
}

export function pixelsToInches(px: number, dpi: number): number {
  return Math.round((px / dpi) * 1000) / 1000
}

function syncTypeForPlacement(placement: string): string {
  if (placement === "front") return "default"
  return placement
}

function printAreaDimensions(
  printfiles: PrintfileInfo[],
  variantPrintfiles: PrintfilesApiResult["variant_printfiles"],
  variantIds: number[],
  placement: string
): { width: number; height: number } {
  const printfileId = printfileIdForPlacement(variantPrintfiles, variantIds, placement)
  const dims = findPrintfileDimensions(printfiles, printfileId, placement)
  if (!dims) {
    return { width: 1800, height: 2400 }
  }
  return dims
}

/**
 * Printful position box — width/height are the art bounding box; clamped inside the print area.
 */
export function clampPrintPosition(position: ApparelPrintPosition): ApparelPrintPosition {
  const areaW = Math.max(1, Math.round(position.area_width))
  const areaH = Math.max(1, Math.round(position.area_height))
  let width = Math.max(1, Math.round(position.width))
  let height = Math.max(1, Math.round(position.height))
  width = Math.min(width, areaW)
  height = Math.min(height, areaH)
  let left = Math.round(position.left)
  let top = Math.round(position.top)
  left = Math.max(0, Math.min(left, areaW - width))
  top = Math.max(0, Math.min(top, areaH - height))
  return {
    area_width: areaW,
    area_height: areaH,
    width,
    height,
    left,
    top,
  }
}

function makePosition(
  areaW: number,
  areaH: number,
  dpi: number,
  artWidthIn: number,
  artHeightIn: number,
  topIn: number,
  leftPx: number
): ApparelPrintPosition {
  const width = inchesToPixels(artWidthIn, dpi)
  const height = inchesToPixels(artHeightIn, dpi)
  return clampPrintPosition({
    area_width: areaW,
    area_height: areaH,
    width,
    height,
    top: inchesToPixels(topIn, dpi),
    left: leftPx,
  })
}

/**
 * Left chest: ~3.75″ wide, top ~3″ below collar, art centre ~4″ toward wearer's left of chest centre.
 * On a flat front print file (as worn), wearer's left is to the right of the vertical centre line.
 */
export function buildLeftChestPosition(areaW: number, areaH: number): ApparelPrintPosition {
  const dpi = resolvePrintAreaDpi(areaW, areaH)
  const artW = 3.75
  const artH = 3.75
  const centerX = areaW / 2
  const artCenterX = centerX + inchesToPixels(4, dpi)
  const left = Math.round(artCenterX - inchesToPixels(artW, dpi) / 2)
  return makePosition(areaW, areaH, dpi, artW, artH, 3, left)
}

export function buildSmallFrontChestPosition(areaW: number, areaH: number): ApparelPrintPosition {
  const dpi = resolvePrintAreaDpi(areaW, areaH)
  const artW = 3.75
  const artH = 3.75
  const left = Math.round((areaW - inchesToPixels(artW, dpi)) / 2)
  return makePosition(areaW, areaH, dpi, artW, artH, 3, left)
}

export function buildCentredFrontPosition(
  areaW: number,
  areaH: number,
  isHoodie: boolean
): ApparelPrintPosition {
  const dpi = resolvePrintAreaDpi(areaW, areaH)
  const artW = 8.5
  const artH = 8.5
  const left = Math.round((areaW - inchesToPixels(artW, dpi)) / 2)
  const topIn = isHoodie ? 2 : (areaH / dpi - artH) / 2
  return makePosition(areaW, areaH, dpi, artW, artH, topIn, left)
}

export function buildCentredBackPosition(areaW: number, areaH: number): ApparelPrintPosition {
  const dpi = resolvePrintAreaDpi(areaW, areaH)
  const artW = 10.5
  const artH = 10.5
  const left = Math.round((areaW - inchesToPixels(artW, dpi)) / 2)
  const topIn = (areaH / dpi - artH) / 2
  return makePosition(areaW, areaH, dpi, artW, artH, topIn, left)
}

export function positionToInches(
  position: ApparelPrintPosition,
  dpi: number
): ApparelPlacementInches {
  return {
    left: pixelsToInches(position.left, dpi),
    top: pixelsToInches(position.top, dpi),
    width: pixelsToInches(position.width, dpi),
    height: pixelsToInches(position.height, dpi),
    areaWidth: pixelsToInches(position.area_width, dpi),
    areaHeight: pixelsToInches(position.area_height, dpi),
  }
}

export function detectApparelIsHoodie(opts: {
  title?: string
  handle?: string
  category?: string
  catalogProductId?: number
}): boolean {
  if (opts.catalogProductId === 146) return true
  const cat = (opts.category || "").toLowerCase()
  if (cat === "hoodies" || cat === "hoodie") return true
  const blob = `${opts.title || ""} ${opts.handle || ""}`.toLowerCase()
  return blob.includes("hoodie") || blob.includes("sweatshirt")
}

export function planApparelPlacementLayout(
  layout: ApparelPlacementLayout,
  printfilesRaw: PrintfilesApiResult,
  variantIds: number[],
  isHoodie: boolean
): ApparelLayoutPlan {
  const printfiles = printfilesRaw.printfiles || []
  const variantPrintfiles = printfilesRaw.variant_printfiles
  const frontDims = printAreaDimensions(printfiles, variantPrintfiles, variantIds, "front")
  const backDims = printAreaDimensions(printfiles, variantPrintfiles, variantIds, "back")

  const placements: ApparelPrintPlacementSpec[] = []

  if (layout === "leftChest") {
    placements.push({
      placement: "front",
      syncFileType: syncTypeForPlacement("front"),
      position: buildLeftChestPosition(frontDims.width, frontDims.height),
    })
  } else if (layout === "chestPlusBack") {
    placements.push({
      placement: "front",
      syncFileType: syncTypeForPlacement("front"),
      position: buildSmallFrontChestPosition(frontDims.width, frontDims.height),
    })
    placements.push({
      placement: "back",
      syncFileType: syncTypeForPlacement("back"),
      position: buildCentredBackPosition(backDims.width, backDims.height),
    })
  } else {
    placements.push({
      placement: "front",
      syncFileType: syncTypeForPlacement("front"),
      position: buildCentredFrontPosition(frontDims.width, frontDims.height, isHoodie),
    })
  }

  const planned: ApparelPlacementPlanEntry[] = placements.map((p) => {
    const dpi = resolvePrintAreaDpi(p.position.area_width, p.position.area_height)
    return {
      ...p,
      dpi,
      inches: positionToInches(p.position, dpi),
    }
  })

  return { layout, isHoodie, placements, planned }
}

/** Full-bleed position for a pre-composited print-area PNG. */
export function buildApparelFullBleedPosition(
  areaW: number,
  areaH: number
): ApparelPrintPosition {
  return {
    area_width: areaW,
    area_height: areaH,
    width: areaW,
    height: areaH,
    left: 0,
    top: 0,
  }
}

export function parseApparelLayout(value: unknown): ApparelPlacementLayout | undefined {
  if (value === "leftChest" || value === "chestPlusBack" || value === "centred") {
    return value
  }
  return undefined
}
