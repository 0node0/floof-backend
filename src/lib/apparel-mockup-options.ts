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
