import { describe, it, expect } from "vitest"
import { capMockupOptionGroupsForProduct } from "../../lib/apparel-mockup-options"

describe("capMockupOptionGroupsForProduct", () => {
  it("keeps at most 3 lifestyle groups for front placement", () => {
    const groups = [
      "Flat",
      "Back",
      "Men's Lifestyle",
      "Women's Lifestyle 3",
      "Lifestyle 2",
    ]
    const capped = capMockupOptionGroupsForProduct("front", groups, 3)
    expect(capped.length).toBe(3)
    expect(capped.some((g) => /lifestyle/i.test(g))).toBe(true)
    expect(capped).not.toContain("Back")
    expect(capped).not.toContain("Flat")
  })
})
