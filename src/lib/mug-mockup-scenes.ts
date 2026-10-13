import { resolveDrinkwareLifestyleOptionGroups } from "./printful-mockup-config"

/** Printful drinkware scenes that mirror the wrap art (e.g. hands cupping from below). */
export function isBlockedMugMockupOptionGroup(group: string): boolean {
  const g = group.trim().toLowerCase()
  if (/^lifestyle\s*3$/i.test(group.trim())) return true
  if (/cup(s|ped)?\s+(the\s+)?mug\s+from\s+below/i.test(g)) return true
  if (/hands?\s+(cup|holding|under)/i.test(g)) return true
  if (/from\s+below/i.test(g) && /hand|cup/i.test(g)) return true
  return false
}

/** Preferred neutral mug lifestyle scenes (woman holding, handheld close-up, …). */
const PREFERRED_ORDER = ["lifestyle", "lifestyle 2", "lifestyle 1"]

function rankGroup(group: string): number {
  const key = group.trim().toLowerCase()
  const idx = PREFERRED_ORDER.indexOf(key)
  if (idx >= 0) return idx
  const m = /^lifestyle\s*(\d+)?$/i.exec(group.trim())
  if (m) return m[1] ? parseInt(m[1], 10) + 10 : 0
  return 100
}

/**
 * Up to 3 lifestyle option_groups for mug mockups — skips blocked (mirrored) scenes.
 */
export function filterDrinkwareMockupOptionGroups(
  available: string[],
  maxGroups = 3
): string[] {
  const resolved = resolveDrinkwareLifestyleOptionGroups(available)
  const candidates = (resolved.length ? resolved : available).filter(
    (g) => !isBlockedMugMockupOptionGroup(g)
  )
  const sorted = [...candidates].sort((a, b) => rankGroup(a) - rankGroup(b))
  const out: string[] = []
  const seen = new Set<string>()
  for (const g of sorted) {
    const key = g.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(g)
    if (out.length >= maxGroups) break
  }
  return out
}

export function drinkwareMockupBatchesFromAvailable(available: string[]) {
  const groups = filterDrinkwareMockupOptionGroups(available, 3)
  return groups.map((g) => ({
    optionGroups: [g],
    gender: "neutral" as const,
  }))
}
