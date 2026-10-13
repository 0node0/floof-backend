import type {
  PrintfulMockupEntry,
  PrintfulMockupTaskResult,
} from "./printful-mockup-generator"
import type { ApparelPlacementLayout } from "./apparel-placement-layout"

export type MockupGarmentView = "front" | "back" | "left" | "right" | "unknown"

export type MockupImageCandidate = {
  url: string
  optionGroup: string
  option: string
  title?: string
  view: MockupGarmentView
  variantIds?: number[]
  /** Primary mockups[].mockup_url (not from extra[]). */
  isMainMockupUrl?: boolean
}

function normalizeUrl(u?: string): string | null {
  if (!u || typeof u !== "string") return null
  const t = u.trim()
  return t.length ? t : null
}

/** Parse garment view from Printful `option` / `title` (never from URL/filename). */
export function parseGarmentViewFromOptionLabel(
  option: string,
  title?: string
): MockupGarmentView {
  const text = `${option || ""} ${title || ""}`.trim().toLowerCase()
  if (!text) return "unknown"

  if (/\bback\b/.test(text) && !/\bback\s*pocket\b/.test(text)) return "back"
  if (/\bleft\b/.test(text)) return "left"
  if (/\bright\b/.test(text)) return "right"
  if (/\bfront\b/.test(text)) return "front"

  return "unknown"
}

function hasMeaningfulOptionLabel(option: string, title?: string): boolean {
  const text = `${option || ""} ${title || ""}`.trim()
  if (!text) return false
  if (text.toLowerCase() === "default") return false
  return true
}

/**
 * Printful's top-level `mockup_url` is the primary front (or placement) render.
 * Only `extra[]` rows need option/title view parsing.
 */
export function inferMainMockupEntryView(
  entry: PrintfulMockupEntry,
  requestedPlacement: string
): MockupGarmentView {
  const placement = String(entry.placement || "").toLowerCase()
  const want = requestedPlacement.toLowerCase()

  if (placement === "back" || want === "back") {
    if (placement === "back") return "back"
  }
  if (placement === "front" || !entry.placement) {
    return "front"
  }
  if (!hasMeaningfulOptionLabel(entry.display_name || "", entry.display_name)) {
    return want === "back" ? "back" : "front"
  }
  const parsed = parseGarmentViewFromOptionLabel(
    entry.display_name || "",
    entry.display_name
  )
  return parsed === "unknown" ? (want === "back" ? "back" : "front") : parsed
}

function pushCandidate(
  out: MockupImageCandidate[],
  seen: Set<string>,
  row: {
    url?: string
    optionGroup: string
    option: string
    title?: string
    variantIds?: number[]
    view?: MockupGarmentView
    isMainMockupUrl?: boolean
  }
) {
  const url = normalizeUrl(row.url)
  if (!url || seen.has(url)) return
  seen.add(url)
  const view =
    row.view ?? parseGarmentViewFromOptionLabel(row.option, row.title)
  out.push({
    url,
    optionGroup: row.optionGroup,
    option: row.option,
    title: row.title,
    view,
    variantIds: row.variantIds,
    isMainMockupUrl: row.isMainMockupUrl,
  })
}

export function extractMockupCandidatesFromTask(
  result: PrintfulMockupTaskResult,
  optionGroup: string,
  requestedPlacement = "front"
): MockupImageCandidate[] {
  const want = optionGroup.toLowerCase()
  const out: MockupImageCandidate[] = []
  const seen = new Set<string>()

  for (const m of result.mockups || []) {
    const variantIds = m.variant_ids

    for (const ex of m.extra || []) {
      const group = String(ex.option_group || optionGroup).trim()
      if (group.toLowerCase() !== want) continue
      const option = String(ex.option || ex.title || "Default").trim()
      pushCandidate(out, seen, {
        url: ex.url || ex.mockup_url,
        optionGroup: group,
        option,
        title: ex.title,
        variantIds,
      })
    }

    const topGroup = String((m as { option_group?: string }).option_group || optionGroup).trim()
    if (topGroup.toLowerCase() !== want) continue

    const mainUrl = m.mockup_url || m.url
    if (!mainUrl) continue

    const option = String(m.display_name || "").trim() || "Default"
    const mainView = inferMainMockupEntryView(m, requestedPlacement)
    pushCandidate(out, seen, {
      url: mainUrl,
      optionGroup: topGroup,
      option,
      title: m.display_name,
      variantIds,
      view: mainView,
      isMainMockupUrl: true,
    })
  }

  return out
}

export function requiredViewForPlacement(
  placement: string,
  _layout: ApparelPlacementLayout
): MockupGarmentView {
  if (placement.toLowerCase() === "back") return "back"
  return "front"
}

/** Front-only layouts must not use back/left/right lifestyle frames for the front placement. */
export function candidateAllowedForPlacement(
  candidate: MockupImageCandidate,
  placement: string,
  layout: ApparelPlacementLayout
): boolean {
  if (candidate.isMainMockupUrl && placement.toLowerCase() === "front") {
    return candidate.view === "front"
  }
  if (candidate.view === "unknown") return false
  if (placement.toLowerCase() === "back") {
    return candidate.view === "back"
  }
  if (candidate.view !== "front") return false
  if (layout === "chestPlusBack" || layout === "leftChest" || layout === "centred") {
    return candidate.view === "front"
  }
  return true
}

export function selectMockupCandidatesForPlacement(
  result: PrintfulMockupTaskResult,
  optionGroup: string,
  placement: string,
  layout: ApparelPlacementLayout
): MockupImageCandidate[] {
  return extractMockupCandidatesFromTask(result, optionGroup, placement).filter((c) =>
    candidateAllowedForPlacement(c, placement, layout)
  )
}

export function pickPreferredMockupCandidate(
  candidates: MockupImageCandidate[]
): MockupImageCandidate | undefined {
  if (!candidates.length) return undefined
  const mainFront = candidates.find((c) => c.isMainMockupUrl && c.view === "front")
  if (mainFront) return mainFront
  const front = candidates.find((c) => c.view === "front")
  if (front) return front
  const back = candidates.find((c) => c.view === "back")
  if (back) return back
  return candidates[0]
}

export function findMatchingBlankCandidate(
  blankCandidates: MockupImageCandidate[],
  design: MockupImageCandidate
): MockupImageCandidate | undefined {
  const norm = (s: string) => s.trim().toLowerCase()
  const optionIsDefault = norm(design.option) === "default"
  return blankCandidates.find((b) => {
    if (b.view !== design.view) return false
    if (norm(b.optionGroup) !== norm(design.optionGroup)) return false
    if (optionIsDefault || norm(b.option) === "default") return true
    return norm(b.option) === norm(design.option)
  })
}
