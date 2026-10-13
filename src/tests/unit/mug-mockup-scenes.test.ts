import { describe, it, expect } from "vitest"
import {
  filterDrinkwareMockupOptionGroups,
  isBlockedMugMockupOptionGroup,
} from "../../lib/mug-mockup-scenes"

describe("mug-mockup-scenes", () => {
  it("blocks lifestyle 3 (hands cupping from below)", () => {
    expect(isBlockedMugMockupOptionGroup("Lifestyle 3")).toBe(true)
    expect(isBlockedMugMockupOptionGroup("Lifestyle")).toBe(false)
    expect(isBlockedMugMockupOptionGroup("Lifestyle 2")).toBe(false)
  })

  it("returns lifestyle and lifestyle 2 only, max 3", () => {
    const groups = filterDrinkwareMockupOptionGroups([
      "Lifestyle",
      "Lifestyle 2",
      "Lifestyle 3",
      "Flat",
    ])
    expect(groups).toEqual(["Lifestyle", "Lifestyle 2"])
  })
})
