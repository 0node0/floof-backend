/**
 * Printful mockup generator helpers (v1 API).
 * Resolves placement, print area, and option_groups from printfiles + layout templates.
 */

import type PrintfulApiClient from "../modules/printful/client"
import { filterDrinkwareMockupOptionGroups } from "./mug-mockup-scenes"
import { drinkwareGallerySortScore } from "./mug-mockup-scene-runner"

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

export type LayoutTemplate = {
  template_id: number
  printfile_id?: number
  template_width?: number
  template_height?: number
  print_area_width?: number
  print_area_height?: number
  print_area_top?: number
  print_area_left?: number
  is_template_on_front?: boolean
  placement?: string
}

export type MockupTemplatesResult = {
  variant_mapping?: Array<{
    variant_id: number
    templates?: Array<{ placement: string; template_id: number }>
  }>
  templates?: LayoutTemplate[]
}

export type MockupProductKind = "apparel" | "drinkware" | "other"

export type MockupOptionBatch = {
  optionGroups: string[]
  gender: "male" | "female" | "neutral"
}

export type ResolvedPrintfulMockupConfig = {
  productKind: MockupProductKind
  placement: string
  syncFileType: string
  position: Record<string, number>
  batches: MockupOptionBatch[]
  optionGroupsAvailable: string[]
  optionsAvailable: string[]
}

export function mugCatalogProductIdsFromEnv(): Set<number> {
  const raw =
    process.env.MUG_CATALOG_PRODUCT_IDS ||
    process.env.MUG_CATALOG_PRODUCT_ID ||
    "19,483"
  const ids = raw
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n))
  return new Set(ids)
}

export function isMugCatalogProductId(catalogProductId: number): boolean {
  return mugCatalogProductIdsFromEnv().has(catalogProductId)
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

export function isDrinkwarePlacement(
  availablePlacements?: Record<string, string> | null
): boolean {
  const keys = availablePlacements ? Object.keys(availablePlacements) : []
  return keys.includes("default") && !keys.includes("front")
}

export function resolveMockupProductKind(
  availablePlacements?: Record<string, string> | null,
  optionGroups?: string[]
): MockupProductKind {
  if (isDrinkwarePlacement(availablePlacements)) return "drinkware"
  if (optionGroups?.some((g) => /men's lifestyle|women's lifestyle/i.test(g))) {
    return "apparel"
  }
  if (availablePlacements?.front) return "apparel"
  return "other"
}

/** Sync product file `type` for the primary print placement. */
export function resolveSyncFileType(placement: string): string {
  if (placement === "front") return "default"
  return placement
}

export function printfileIdForPlacement(
  variantPrintfiles: PrintfilesApiResult["variant_printfiles"],
  variantIds: number[],
  placement: string
): number | undefined {
  for (const vid of variantIds) {
    const row = variantPrintfiles?.find((v) => v.variant_id === vid)
    const id = row?.placements?.[placement]
    if (id != null) return id
  }
  return variantPrintfiles?.[0]?.placements?.[placement]
}

export function findPrintfileDimensions(
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

/**
 * Mug/sublimation wrap: center the art on the front panel (middle of the wrap),
 * not full bleed across the handle — so lifestyle cameras see the design.
 */
export function buildDrinkwareFrontFacingPosition(
  areaW: number,
  areaH: number,
  widthRatio = 0.36
): Record<string, number> {
  const width = Math.round(areaW * widthRatio)
  const height = Math.round(Math.min(width, areaH * 0.92))
  const w = Math.min(width, height)
  const h = w
  return {
    area_width: areaW,
    area_height: areaH,
    width: w,
    height: h,
    left: Math.round((areaW - w) / 2),
    top: Math.round((areaH - h) / 2),
  }
}

export function findLayoutTemplateForVariant(
  templatesResult: MockupTemplatesResult | null | undefined,
  variantId: number,
  placement: string
): LayoutTemplate | null {
  if (!templatesResult?.templates?.length) return null
  const mapping = templatesResult.variant_mapping?.find((v) => v.variant_id === variantId)
  const templateId =
    mapping?.templates?.find((t) => t.placement === placement)?.template_id ??
    mapping?.templates?.[0]?.template_id
  if (templateId == null) return null
  return templatesResult.templates.find((t) => t.template_id === templateId) ?? null
}

export function buildDrinkwarePositionFromTemplateAndPrintfile(
  template: LayoutTemplate | null,
  printfileDims: { width: number; height: number }
): Record<string, number> {
  const areaW = printfileDims.width
  const areaH = printfileDims.height

  if (template?.print_area_width && template.print_area_height) {
    const scaleX = areaW / (template.print_area_width || areaW)
    const scaleY = areaH / (template.print_area_height || areaH)
    const w = Math.round(Math.min(template.print_area_width * scaleX * 0.85, areaW * 0.38))
    const h = Math.round(Math.min(template.print_area_height * scaleY * 0.85, areaH * 0.92))
    const size = Math.min(w, h)
    return {
      area_width: areaW,
      area_height: areaH,
      width: size,
      height: size,
      left: Math.round((areaW - size) / 2),
      top: Math.round((areaH - size) / 2),
    }
  }

  return buildDrinkwareFrontFacingPosition(areaW, areaH)
}

export function buildPrintPositionFromPrintfiles(
  printfiles: PrintfileInfo[],
  variantPrintfiles: PrintfilesApiResult["variant_printfiles"],
  variantIds: number[],
  placement: string,
  productKind: MockupProductKind = "apparel",
  layoutTemplate?: LayoutTemplate | null
): Record<string, number> {
  const printfileId = printfileIdForPlacement(variantPrintfiles, variantIds, placement)
  const dims = findPrintfileDimensions(printfiles, printfileId, placement)
  if (!dims) return { ...DEFAULT_POSITION }

  if (productKind === "drinkware") {
    return buildDrinkwarePositionFromTemplateAndPrintfile(layoutTemplate ?? null, dims)
  }
  return buildCenteredPrintPosition(dims.width, dims.height)
}

function lifestyleRank(name: string): number {
  const m = /^lifestyle\s*(\d+)?$/i.exec(name.trim())
  if (!m) return 50
  return m[1] ? parseInt(m[1], 10) : 1
}

/** Drinkware lifestyle groups: Lifestyle, Lifestyle 2, Lifestyle 3 (supports "Lifestyle 1" alias). */
export function resolveDrinkwareLifestyleOptionGroups(available: string[]): string[] {
  const normalized = new Map<string, string>()
  for (const g of available) {
    const t = g.trim()
    if (/^lifestyle(\s+1)?$/i.test(t)) normalized.set("Lifestyle", t === "Lifestyle 1" ? "Lifestyle" : t)
    else if (/^lifestyle\s+[2-9]\d*$/i.test(t)) normalized.set(t, t)
  }

  const ordered = ["Lifestyle", "Lifestyle 2", "Lifestyle 3"]
  const resolved: string[] = []
  for (const want of ordered) {
    const actual = available.find((g) => g.trim().toLowerCase() === want.toLowerCase())
    if (actual) resolved.push(actual)
    else if (want === "Lifestyle" && normalized.has("Lifestyle")) {
      const pick = available.find((g) => /^lifestyle(\s+1)?$/i.test(g.trim()))
      if (pick) resolved.push(pick)
    }
  }

  if (resolved.length) return resolved.slice(0, 3)

  return available
    .filter((g) => /^lifestyle(\s+\d+)?$/i.test(g.trim()) && !/men|women|flat/i.test(g))
    .sort((a, b) => lifestyleRank(a) - lifestyleRank(b))
    .slice(0, 3)
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

function drinkwareBatches(groups: string[]): MockupOptionBatch[] {
  return groups.slice(0, 3).map((g) => ({ optionGroups: [g], gender: "neutral" as const }))
}

/**
 * Choose mockup option_group batches. Drinkware uses one Printful task per Lifestyle group.
 */
export function selectMockupOptionBatches(
  available: string[],
  overrideGroups?: string[],
  productKind: MockupProductKind = "other"
): MockupOptionBatch[] {
  if (overrideGroups?.length) {
    if (productKind === "drinkware") {
      return drinkwareBatches(overrideGroups)
    }
    return [{ optionGroups: overrideGroups, gender: "neutral" }]
  }

  if (!available.length) {
    return []
  }

  if (productKind === "drinkware") {
    const groups = filterDrinkwareMockupOptionGroups(available, 3)
    if (groups.length) return drinkwareBatches(groups)
  }

  const lifestyleOnly = pickLifestyleGroups(available, 4)
  if (lifestyleOnly.length && !hasApparelLifestyleGroups(available)) {
    return drinkwareBatches(lifestyleOnly)
  }

  const batches: MockupOptionBatch[] = []
  const male = pickGenderLifestyleGroups(available, "male", 3)
  const female = pickGenderLifestyleGroups(available, "female", 3)
  if (male.length) batches.push({ optionGroups: male, gender: "male" })
  if (female.length) batches.push({ optionGroups: female, gender: "female" })

  if (!batches.length && lifestyleOnly.length) {
    return drinkwareBatches(lifestyleOnly)
  }

  return batches
}

export function parsePrintfilesResponse(raw: PrintfilesApiResult): ResolvedPrintfulMockupConfig {
  const placement = resolveMockupPlacement(raw.available_placements)
  const productKind = resolveMockupProductKind(raw.available_placements, raw.option_groups)
  const printfiles = raw.printfiles || []
  const batches = selectMockupOptionBatches(raw.option_groups || [], undefined, productKind)
  return {
    productKind,
    placement,
    syncFileType: resolveSyncFileType(placement),
    position: buildPrintPositionFromPrintfiles(
      printfiles,
      raw.variant_printfiles,
      [],
      placement,
      productKind
    ),
    batches,
    optionGroupsAvailable: raw.option_groups || [],
    optionsAvailable: raw.options || [],
  }
}

export type MockupShotLike = {
  url: string
  title?: string
  kind?: string
}

/** Gallery for drinkware: first image is Lifestyle #1, then 2 & 3, then any extras. */
/** Lifestyle mockups first, then flat print-art previews (no stock catalog blanks). */
export function buildMugProductGallery(
  lifestyleShots: MockupShotLike[],
  flatArtUrls: string[] = [],
  excludeUrls: string[] = []
): string[] {
  const exclude = new Set(excludeUrls.filter(Boolean))
  const lifestyle = buildDrinkwareLifestyleGallery(
    lifestyleShots.filter((s) => s.url && !exclude.has(s.url))
  )
  if (lifestyle.length > 0) {
    return lifestyle.slice(0, 10)
  }
  const flat = flatArtUrls.filter((u) => u && !exclude.has(u))
  const urls: string[] = []
  const push = (u?: string) => {
    if (u && !urls.includes(u)) urls.push(u)
  }
  for (const u of flat) push(u)
  return urls.slice(0, 10)
}

export function buildDrinkwareLifestyleGallery(
  shots: MockupShotLike[],
  extras: string[] = []
): string[] {
  const sorted = [...shots].sort(
    (a, b) => drinkwareGallerySortScore(a.title) - drinkwareGallerySortScore(b.title)
  )
  const urls: string[] = []
  const seenScene = new Set<string>()
  const push = (u?: string, sceneKey?: string) => {
    if (!u || u.includes("/floof/design-files/")) return
    if (urls.includes(u)) return
    if (sceneKey && seenScene.has(sceneKey)) return
    if (sceneKey) seenScene.add(sceneKey)
    urls.push(u)
  }

  for (const s of sorted) {
    if (urls.length >= 3) break
    const scene = (() => {
      const m = /lifestyle\s*(\d+)?/i.exec(s.title || "")
      if (m) return `lifestyle-${m[1] || "1"}`
      return s.title || s.url
    })()
    push(s.url, scene)
  }
  for (const u of extras) {
    if (urls.length >= 3) break
    push(u)
  }
  return urls.slice(0, 3)
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
  const productKind = resolveMockupProductKind(raw.available_placements, raw.option_groups)

  let layoutTemplate: LayoutTemplate | null = null
  if (productKind === "drinkware" && variantIds[0]) {
    try {
      const templates = await client.get<MockupTemplatesResult>(
        `/mockup-generator/templates/${catalogProductId}`
      )
      layoutTemplate = findLayoutTemplateForVariant(templates, variantIds[0], placement)
    } catch {
      layoutTemplate = null
    }
  }

  const batches = selectMockupOptionBatches(
    raw.option_groups || [],
    optionGroupsOverride,
    productKind
  )

  return {
    productKind,
    placement,
    syncFileType: resolveSyncFileType(placement),
    position: buildPrintPositionFromPrintfiles(
      raw.printfiles || [],
      raw.variant_printfiles,
      variantIds,
      placement,
      productKind,
      layoutTemplate
    ),
    batches,
    optionGroupsAvailable: raw.option_groups || [],
    optionsAvailable: raw.options || [],
  }
}
