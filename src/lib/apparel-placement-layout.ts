import {
  findPrintfileDimensions,
  printfileIdForPlacement,
  type PrintfileInfo,
  type PrintfilesApiResult,
} from "./printful-mockup-config"

export const APPAREL_PRINT_DPI = 300

export type ApparelPlacementLayout = "leftChest" | "chestPlusBack" | "centred"

export type ApparelPrintPlacementSpec = {
  placement: string
  syncFileType: string
  position: Record<string, number>
}

export type ApparelLayoutPlan = {
  layout: ApparelPlacementLayout
  isHoodie: boolean
  placements: ApparelPrintPlacementSpec[]
}

export function inchesToPrintPixels(inches: number): number {
  return Math.round(inches * APPAREL_PRINT_DPI)
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

function fitArtBoxInArea(
  areaW: number,
  areaH: number,
  targetWidthPx: number,
  targetHeightPx: number,
  top: number,
  left: number
): Record<string, number> {
  const width = Math.min(targetWidthPx, areaW - left)
  const height = Math.min(targetHeightPx, areaH - top)
  return {
    area_width: areaW,
    area_height: areaH,
    width: Math.max(1, width),
    height: Math.max(1, height),
    top: Math.max(0, top),
    left: Math.max(0, left),
  }
}

/** Wearer's left chest on a flat front print file sits to the right of the centre line. */
export function buildLeftChestPosition(areaW: number, areaH: number): Record<string, number> {
  const designW = inchesToPrintPixels(3.75)
  const designH = designW
  const top = inchesToPrintPixels(3)
  const centerX = areaW / 2
  const chestCenterX = centerX + inchesToPrintPixels(4)
  const left = Math.round(chestCenterX - designW / 2)
  return fitArtBoxInArea(areaW, areaH, designW, designH, top, left)
}

export function buildSmallFrontChestPosition(areaW: number, areaH: number): Record<string, number> {
  const designW = inchesToPrintPixels(3.75)
  const designH = designW
  const top = inchesToPrintPixels(3)
  const left = Math.round((areaW - designW) / 2)
  return fitArtBoxInArea(areaW, areaH, designW, designH, top, left)
}

export function buildCentredFrontPosition(
  areaW: number,
  areaH: number,
  isHoodie: boolean
): Record<string, number> {
  const designW = inchesToPrintPixels(8.5)
  const designH = designW
  const left = Math.round((areaW - designW) / 2)
  const top = isHoodie
    ? inchesToPrintPixels(2)
    : Math.round((areaH - designH) / 2)
  return fitArtBoxInArea(areaW, areaH, designW, designH, top, left)
}

export function buildCentredBackPosition(areaW: number, areaH: number): Record<string, number> {
  const designW = inchesToPrintPixels(10.5)
  const designH = designW
  const left = Math.round((areaW - designW) / 2)
  const top = Math.round((areaH - designH) / 2)
  return fitArtBoxInArea(areaW, areaH, designW, designH, top, left)
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

  return { layout, isHoodie, placements }
}

/** Full-bleed position for a pre-composited print-area PNG. */
export function buildApparelFullBleedPosition(
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

export function parseApparelLayout(value: unknown): ApparelPlacementLayout | undefined {
  if (value === "leftChest" || value === "chestPlusBack" || value === "centred") {
    return value
  }
  return undefined
}
