import type {
  PrintfulMockupEntry,
  PrintfulMockupExtra,
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
}

function normalizeUrl(u?: string): string | null {
  if (!u || typeof u !== "string") return null
  const t = u.trim()
  return t.length ? t : null
}

/** Parse garment view from Printful `option` / `title` only (never from URL/filename). */
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

function pushCandidate(
  out: MockupImageCandidate[],
  seen: Set<string>,
  row: {
    url?: string
    optionGroup: string
    option: string
    title?: string
    variantIds?: number[]
  }
) {
  const url = normalizeUrl(row.url)
  if (!url || seen.has(url)) return
  seen.add(url)
  const view = parseGarmentViewFromOptionLabel(row.option, row.title)
  out.push({
    url,
    optionGroup: row.optionGroup,
    option: row.option,
    title: row.title,
    view,
    variantIds: row.variantIds,
  })
}

export function extractMockupCandidatesFromTask(
  result: PrintfulMockupTaskResult,
  optionGroup: string
): MockupImageCandidate[] {
  const want = optionGroup.toLowerCase()
  const out: MockupImageCandidate[] = []
  const seen = new Set<string>()

  for (const m of result.mockups || []) {
    const variantIds = m.variant_ids
    let matchedExtra = false

    for (const ex of m.extra || []) {
      const group = String(ex.option_group || optionGroup).trim()
      if (group.toLowerCase() !== want) continue
      matchedExtra = true
      const option = String(ex.option || ex.title || "Default").trim()
      pushCandidate(out, seen, {
        url: ex.url || ex.mockup_url,
        optionGroup: group,
        option,
        title: ex.title,
        variantIds,
      })
    }

    if (matchedExtra) continue

    const topGroup = String((m as { option_group?: string }).option_group || optionGroup).trim()
    if (topGroup.toLowerCase() !== want) continue

    const option = String(m.display_name || "Default").trim()
    pushCandidate(out, seen, {
      url: m.mockup_url || m.url,
      optionGroup: topGroup,
      option,
      title: m.display_name,
      variantIds,
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
  const required = requiredViewForPlacement(placement, layout)
  if (candidate.view === "unknown") return false
  if (placement.toLowerCase() === "back") {
    return candidate.view === "back"
  }
  if (candidate.view !== "front") return false
  if (layout === "chestPlusBack" || layout === "leftChest" || layout === "centred") {
    return candidate.view === "front"
  }
  return candidate.view === required
}

export function selectMockupCandidatesForPlacement(
  result: PrintfulMockupTaskResult,
  optionGroup: string,
  placement: string,
  layout: ApparelPlacementLayout
): MockupImageCandidate[] {
  return extractMockupCandidatesFromTask(result, optionGroup).filter((c) =>
    candidateAllowedForPlacement(c, placement, layout)
  )
}

export function pickPreferredMockupCandidate(
  candidates: MockupImageCandidate[]
): MockupImageCandidate | undefined {
  if (!candidates.length) return undefined
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
  return blankCandidates.find(
    (b) =>
      b.view === design.view &&
      norm(b.option) === norm(design.option) &&
      norm(b.optionGroup) === norm(design.optionGroup)
  )
}
