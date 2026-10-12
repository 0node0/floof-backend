/**
 * Printful mockup generator helpers (v1 API).
 * Resolves placement, print area, and option_groups from /mockup-generator/printfiles.
 */

import type PrintfulApiClient from "../modules/printful/client"

export type PrintfileInfo = {
  printfile_id?: number
  width?: number
  height?: number
  fill_mode?: string
  can_rotate?: boolean
  placement?: string
  type?: string
}

export type PrintfilesApiResult = {
  product_id?: number
  available_placements?: Record<string, string>
  option_groups?: string[]
  options?: string[]
  printfiles?: PrintfileInfo[]
  variant_printfiles?: Array<{
    variant_id: number
    placements?: Record<string, number>
  }>
}

export type MockupOptionBatch = {
  optionGroups: string[]
  gender: "male" | "female" | "neutral"
}

export type ResolvedPrintfulMockupConfig = {
  placement: string
  syncFileType: string
  position: Record<string, number>
  batches: MockupOptionBatch[]
  optionGroupsAvailable: string[]
}

const DEFAULT_POSITION: Record<string, number> = {
  area_width: 1800,
  area_height: 2400,
  width: 1800,
  height: 1800,
  top: 300,
  left: 0,
}

/** Remove legacy "FLOOF —" / "FLOOF -" prefixes from storefront titles. */
export function stripFloofProductTitle(title: string): string {
  return title.replace(/^FLOOF\s*[-–—]\s*/i, "").trim()
}

/** Pick mockup placement from Printful available_placements (mugs → default, apparel → front). */
export function resolveMockupPlacement(
  availablePlacements?: Record<string, string> | null
): string {
  const keys = availablePlacements ? Object.keys(availablePlacements) : []
  if (keys.includes("front")) return "front"
  if (keys.includes("default")) return "default"
  return keys[0] || "front"
}

/** Sync product file `type` for the primary print placement. */
export function resolveSyncFileType(placement: string): string {
  if (placement === "front") return "default"
  return placement
}

function printfileIdForPlacement(
  variantPrintfiles: PrintfilesApiResult["variant_printfiles"],
  variantIds: number[],
  placement: string
): number | undefined {
  for (const vid of variantIds) {
    const row = variantPrintfiles?.find((v) => v.variant_id === vid)
    const id = row?.placements?.[placement]
    if (id != null) return id
  }
  const first = variantPrintfiles?.[0]?.placements?.[placement]
  return first
}

function findPrintfileDimensions(
  printfiles: PrintfileInfo[],
  printfileId: number | undefined,
  placement: string
): { width: number; height: number } | null {
  let pf: PrintfileInfo | undefined
  if (printfileId != null) {
    pf = printfiles.find((p) => p.printfile_id === printfileId)
  }
  if (!pf) {
    pf =
      printfiles.find(
        (p) =>
          p.placement === placement ||
          String(p.type || "").toLowerCase() === placement.toLowerCase()
      ) ||
      printfiles.find((p) => String(p.type || "").includes(placement)) ||
      printfiles[0]
  }
  if (pf?.width && pf?.height) {
    return { width: Number(pf.width), height: Number(pf.height) }
  }
  return null
}

/** Centered design box covering ~80% of print area height (apparel default). */
export function buildCenteredPrintPosition(
  areaW: number,
  areaH: number,
  heightRatio = 0.8
): Record<string, number> {
  const h = Math.round(areaH * heightRatio)
  return {
    area_width: areaW,
    area_height: areaH,
    width: areaW,
    height: h,
    top: Math.round((areaH - h) / 2),
    left: 0,
  }
}

export function buildPrintPositionFromPrintfiles(
  printfiles: PrintfileInfo[],
  variantPrintfiles: PrintfilesApiResult["variant_printfiles"],
  variantIds: number[],
  placement: string
): Record<string, number> {
  const printfileId = printfileIdForPlacement(variantPrintfiles, variantIds, placement)
  const dims = findPrintfileDimensions(printfiles, printfileId, placement)
  if (!dims) return { ...DEFAULT_POSITION }
  return buildCenteredPrintPosition(dims.width, dims.height)
}

function lifestyleRank(name: string): number {
  const m = /^lifestyle\s*(\d+)?$/i.exec(name.trim())
  if (!m) return 50
  return m[1] ? parseInt(m[1], 10) : 1
}

function pickLifestyleGroups(available: string[], max = 4): string[] {
  const exact = available
    .filter((g) => /^lifestyle(\s+\d+)?$/i.test(g.trim()))
    .sort((a, b) => lifestyleRank(a) - lifestyleRank(b))
  if (exact.length) return exact.slice(0, max)

  const loose = available
    .filter((g) => /lifestyle/i.test(g) && !/men|women/i.test(g))
    .sort((a, b) => lifestyleRank(a) - lifestyleRank(b))
  return loose.slice(0, max)
}

function pickGenderLifestyleGroups(
  available: string[],
  gender: "male" | "female",
  max = 3
): string[] {
  const base = gender === "male" ? "Men's Lifestyle" : "Women's Lifestyle"
  const ordered = [base, `${base} 2`, `${base} 3`, `${base} 4`]
  const found = ordered.filter((g) => available.includes(g))
  if (found.length) return found.slice(0, max)

  const prefix = gender === "male" ? "Men's" : "Women's"
  const fallbacks = available.filter((g) => g.startsWith(prefix) && /lifestyle/i.test(g))
  if (fallbacks.length) return fallbacks.slice(0, max)

  const plain = available.filter((g) => g === prefix || g.startsWith(`${prefix} `))
  return plain.slice(0, max)
}

function hasApparelLifestyleGroups(available: string[]): boolean {
  return available.some((g) => /men's lifestyle|women's lifestyle/i.test(g))
}

/**
 * Choose mockup option_group batches. Prefers Lifestyle 1–4 (or "Lifestyle", "Lifestyle 2", …)
 * for drinkware/posters; uses Men's/Women's lifestyle sets for apparel.
 */
export function selectMockupOptionBatches(
  available: string[],
  overrideGroups?: string[]
): MockupOptionBatch[] {
  if (overrideGroups?.length) {
    return [{ optionGroups: overrideGroups, gender: "neutral" }]
  }

  if (!available.length) {
    return []
  }

  const lifestyleOnly = pickLifestyleGroups(available, 4)
  if (lifestyleOnly.length && !hasApparelLifestyleGroups(available)) {
    return [{ optionGroups: lifestyleOnly, gender: "neutral" }]
  }

  const batches: MockupOptionBatch[] = []
  const male = pickGenderLifestyleGroups(available, "male", 3)
  const female = pickGenderLifestyleGroups(available, "female", 3)
  if (male.length) batches.push({ optionGroups: male, gender: "male" })
  if (female.length) batches.push({ optionGroups: female, gender: "female" })

  if (!batches.length && lifestyleOnly.length) {
    batches.push({ optionGroups: lifestyleOnly, gender: "neutral" })
  }

  return batches
}

export function parsePrintfilesResponse(raw: PrintfilesApiResult): ResolvedPrintfulMockupConfig {
  const placement = resolveMockupPlacement(raw.available_placements)
  const printfiles = raw.printfiles || []
  const batches = selectMockupOptionBatches(raw.option_groups || [])
  return {
    placement,
    syncFileType: resolveSyncFileType(placement),
    position: buildPrintPositionFromPrintfiles(
      printfiles,
      raw.variant_printfiles,
      [],
      placement
    ),
    batches,
    optionGroupsAvailable: raw.option_groups || [],
  }
}

export async function loadPrintfulMockupConfig(
  client: PrintfulApiClient,
  catalogProductId: number,
  variantIds: number[],
  optionGroupsOverride?: string[]
): Promise<ResolvedPrintfulMockupConfig> {
  const raw = await client.get<PrintfilesApiResult>(
    `/mockup-generator/printfiles/${catalogProductId}`
  )
  const placement = resolveMockupPlacement(raw.available_placements)
  const batches = selectMockupOptionBatches(raw.option_groups || [], optionGroupsOverride)
  return {
    placement,
    syncFileType: resolveSyncFileType(placement),
    position: buildPrintPositionFromPrintfiles(
      raw.printfiles || [],
      raw.variant_printfiles,
      variantIds,
      placement
    ),
    batches,
    optionGroupsAvailable: raw.option_groups || [],
  }
}
