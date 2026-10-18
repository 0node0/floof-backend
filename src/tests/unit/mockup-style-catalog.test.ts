import { describe, it, expect } from "vitest"
import {
  categorizeMockupStyleName,
  listMockupStylesFromPrintfiles,
  planOutkastGalleryStyles,
} from "../../lib/mockup-style-catalog"
import type { PrintfilesApiResult } from "../../lib/printful-mockup-config"

describe("mockup-style-catalog", () => {
  const sample: PrintfilesApiResult = {
    available_placements: { front: "Front", back: "Back" },
    option_groups: [
      "Flat",
      "Ghost",
      "Back",
      "Folded",
      "Hanging",
      "Front Closeup",
      "Men's Lifestyle",
    ],
    options: ["Front", "Back", "Front Closeup", "Detail"],
  }

  it("lists placements and categorizes option groups", () => {
    const listed = listMockupStylesFromPrintfiles(71, sample)
    expect(listed.catalogProductId).toBe(71)
    expect(listed.placements.map((p) => p.key)).toEqual(["front", "back"])
    expect(listed.optionGroups.find((g) => g.name === "Ghost")?.category).toBe("ghost")
    expect(listed.optionGroups.find((g) => g.name === "Back")?.category).toBe("back")
    expect(categorizeMockupStyleName("Front Closeup")).toBe("closeup")
  })

  it("plans Outkast gallery with ghost front, back, and detail groups", () => {
    const plan = planOutkastGalleryStyles(sample.option_groups || [])
    expect(plan.frontGroup).toBe("Ghost")
    expect(plan.backGroup).toBe("Back")
    expect(plan.detailGroups).toContain("Front Closeup")
    expect(plan.extraGroups).toEqual(["Folded", "Hanging"])
  })

  it("falls back to flat when ghost is unavailable", () => {
    const plan = planOutkastGalleryStyles(["Flat", "Back", "Folded"])
    expect(plan.frontGroup).toBe("Flat")
    expect(plan.backGroup).toBe("Back")
  })
})
