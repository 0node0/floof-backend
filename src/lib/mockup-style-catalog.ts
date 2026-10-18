import type PrintfulApiClient from "../modules/printful/client"
import type { PrintfilesApiResult } from "./printful-mockup-config"

export type MockupStyleCategory =
  | "flat"
  | "ghost"
  | "folded"
  | "hanging"
  | "back"
  | "closeup"
  | "detail"
  | "lifestyle"
  | "on_model"
  | "other"

export type MockupStyleOptionRow = {
  name: string
  category: MockupStyleCategory
}

export type MockupPlacementRow = {
  key: string
  label: string
}

export type ListMockupStylesResult = {
  catalogProductId: number
  placements: MockupPlacementRow[]
  optionGroups: MockupStyleOptionRow[]
  options: MockupStyleOptionRow[]
  productTitle?: string
}

export function categorizeMockupStyleName(name: string): MockupStyleCategory {
  const g = name.trim().toLowerCase()
  if (!g) return "other"
  if (/^ghost$/i.test(g) || /\bghost\b/.test(g)) return "ghost"
  if (/^flat$/i.test(g) || /^flat\s+front/i.test(g)) return "flat"
  if (/^back$/i.test(g) || /\bback\s+view\b/.test(g) || /^flat\s+back/i.test(g)) return "back"
  if (/^folded/i.test(g)) return "folded"
  if (/^hanging/i.test(g)) return "hanging"
  if (/zoomed\s*in|close.?up/i.test(g)) return "closeup"
  if (/product\s+details|detail|collar|label|stitch|fabric|sleeve|cuff|hem/i.test(g)) {
    return "detail"
  }
  if (/lifestyle|on.?model|men'?s|women'?s/i.test(g)) return "lifestyle"
  return "other"
}

export function listMockupStylesFromPrintfiles(
  catalogProductId: number,
  raw: PrintfilesApiResult,
  productTitle?: string
): ListMockupStylesResult {
  const placements: MockupPlacementRow[] = Object.entries(raw.available_placements || {}).map(
    ([key, label]) => ({ key, label: String(label) })
  )
  const optionGroups = (raw.option_groups || []).map((name) => ({
    name,
    category: categorizeMockupStyleName(name),
  }))
  const options = (raw.options || []).map((name) => ({
    name,
    category: categorizeMockupStyleName(name),
  }))
  return {
    catalogProductId,
    placements,
    optionGroups,
    options,
    productTitle,
  }
}

export async function listPrintfulMockupStyles(
  client: PrintfulApiClient,
  catalogProductId: number
): Promise<ListMockupStylesResult> {
  const raw = await client.get<PrintfilesApiResult>(
    `/mockup-generator/printfiles/${catalogProductId}`
  )
  return listMockupStylesFromPrintfiles(catalogProductId, raw)
}

export type OutkastGalleryPlan = {
  ghostFront: string | null
  zoomedIn: string | null
  /** Back mockup group (Back preferred; Flat fallback for flat back). */
  backGroup: string | null
  productDetails: string | null
}

function findOptionGroup(groups: string[], patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const hit = groups.find((g) => pattern.test(g.trim()))
    if (hit) return hit
  }
  return null
}

/**
 * Outkast PDP gallery: Ghost front, Zoomed in, Ghost/Flat back, Product details.
 * Matches Printful names on Bella 3001 (#71): Ghost, Zoomed in, Back, Product details.
 */
export function planOutkastGalleryStyles(optionGroupNames: string[]): OutkastGalleryPlan {
  const groups = [...new Set(optionGroupNames.map((g) => g.trim()).filter(Boolean))]
  const ghostFront =
    findOptionGroup(groups, [/^ghost$/i]) ||
    findOptionGroup(groups, [/\bghost\b/i])
  const zoomedIn = findOptionGroup(groups, [/^zoomed\s*in$/i, /zoomed\s*in/i])
  const backGroup =
    findOptionGroup(groups, [/^back$/i]) ||
    findOptionGroup(groups, [/^flat$/i, /flat\s+back/i])
  const productDetails = findOptionGroup(groups, [
    /^product\s+details$/i,
    /product\s+details/i,
  ])
  return {
    ghostFront,
    zoomedIn,
    backGroup,
    productDetails,
  }
}

/** Ordered slots for gallery generation (skips missing groups). */
export function outkastGallerySlotsFromPlan(plan: OutkastGalleryPlan): Array<{
  slot: "ghost-front" | "zoomed-in" | "back" | "product-details"
  optionGroup: string
}> {
  const slots: Array<{
    slot: "ghost-front" | "zoomed-in" | "back" | "product-details"
    optionGroup: string
  }> = []
  if (plan.ghostFront) slots.push({ slot: "ghost-front", optionGroup: plan.ghostFront })
  if (plan.zoomedIn) slots.push({ slot: "zoomed-in", optionGroup: plan.zoomedIn })
  if (plan.backGroup) slots.push({ slot: "back", optionGroup: plan.backGroup })
  if (plan.productDetails) {
    slots.push({ slot: "product-details", optionGroup: plan.productDetails })
  }
  return slots
}
