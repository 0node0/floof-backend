import { describe, it, expect } from "vitest"
import {
  filterMockupOptionGroupsForPlacement,
  isBackViewMockupOptionGroup,
} from "../../lib/apparel-mockup-options"

describe("apparel-mockup-options", () => {
  it("detects back-view option groups", () => {
    expect(isBackViewMockupOptionGroup("Back")).toBe(true)
    expect(isBackViewMockupOptionGroup("Men's Lifestyle")).toBe(false)
  })

  it("filters back views off front placement mockups", () => {
    const groups = ["Flat", "Back", "Men's Lifestyle", "Women's Lifestyle"]
    expect(filterMockupOptionGroupsForPlacement("front", groups)).toEqual([
      "Flat",
      "Men's Lifestyle",
      "Women's Lifestyle",
    ])
  })

  it("prefers back views for back placement when available", () => {
    const groups = ["Flat", "Back", "Men's Lifestyle"]
    expect(filterMockupOptionGroupsForPlacement("back", groups)).toEqual(["Back"])
  })
})
