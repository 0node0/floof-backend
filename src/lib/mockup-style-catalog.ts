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
  if (/close.?up|detail|zoom|collar|label|stitch|fabric|sleeve|cuff|hem/i.test(g)) {
    return /close.?up/i.test(g) ? "closeup" : "detail"
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
  frontGroup: string | null
  backGroup: string | null
  detailGroups: string[]
  extraGroups: string[]
}

/** Studio gallery: ghost (else flat) front, flat back, then close-up / detail groups. */
export function planOutkastGalleryStyles(optionGroupNames: string[]): OutkastGalleryPlan {
  const groups = [...new Set(optionGroupNames.map((g) => g.trim()).filter(Boolean))]
  const ghost = groups.find((g) => categorizeMockupStyleName(g) === "ghost")
  const flat = groups.find((g) => categorizeMockupStyleName(g) === "flat")
  const back = groups.find((g) => categorizeMockupStyleName(g) === "back")
  const detailGroups = groups.filter((g) => {
    const c = categorizeMockupStyleName(g)
    return c === "closeup" || c === "detail"
  })
  const extraGroups = groups.filter((g) => {
    const c = categorizeMockupStyleName(g)
    return c === "folded" || c === "hanging"
  })
  return {
    frontGroup: ghost || flat || null,
    backGroup: back || null,
    detailGroups,
    extraGroups,
  }
}
