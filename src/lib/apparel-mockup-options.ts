/** Printful option_group names that render the garment back (not front lifestyle). */
export function isBackViewMockupOptionGroup(group: string): boolean {
  const g = group.trim()
  if (/^back\b/i.test(g)) return true
  if (/\bback\s+view\b/i.test(g)) return true
  if (/\bback$/i.test(g)) return true
  return false
}

export function filterMockupOptionGroupsForPlacement(
  placement: string,
  groups: string[]
): string[] {
  const isBackPlacement = placement.toLowerCase() === "back"
  if (isBackPlacement) {
    const backGroups = groups.filter((g) => isBackViewMockupOptionGroup(g))
    if (backGroups.length) return backGroups
    return groups.filter((g) => !/^flat\b/i.test(g))
  }
  return groups.filter((g) => !isBackViewMockupOptionGroup(g))
}

function scoreMockupOptionGroup(group: string, placement: string): number {
  const g = group.toLowerCase()
  let score = 0
  if (/lifestyle/i.test(g)) score += 20
  if (/women/i.test(g)) score += 2
  if (/men/i.test(g)) score += 1
  if (/flat/i.test(g)) score -= 15
  if (placement === "front" && /\bback\b/i.test(g)) score -= 30
  if (placement === "back" && /\bback\b/i.test(g)) score += 10
  return score
}

/** Limit mockup tasks per product to reduce Printful 429s (prefer lifestyle front groups). */
export function capMockupOptionGroupsForProduct(
  placement: string,
  groups: string[],
  max = Number(process.env.PRINTFUL_MOCKUP_OPTION_GROUP_CAP || 3)
): string[] {
  const unique = [...new Set(groups.filter(Boolean))]
  if (unique.length <= max) return unique
  return [...unique]
    .sort((a, b) => scoreMockupOptionGroup(b, placement) - scoreMockupOptionGroup(a, placement))
    .slice(0, max)
}
