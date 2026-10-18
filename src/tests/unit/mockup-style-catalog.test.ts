import { describe, it, expect } from "vitest"
import {
  categorizeMockupStyleName,
  listMockupStylesFromPrintfiles,
  outkastGallerySlotsFromPlan,
  planOutkastGalleryStyles,
} from "../../lib/mockup-style-catalog"
import type { PrintfilesApiResult } from "../../lib/printful-mockup-config"

describe("mockup-style-catalog", () => {
  const bella3001: PrintfilesApiResult = {
    available_placements: { front: "Front", back: "Back" },
    option_groups: [
      "Ghost",
      "Flat",
      "Zoomed in",
      "Product details",
      "Back",
      "Men's Lifestyle",
    ],
    options: ["Front", "Back"],
  }

  it("lists placements and categorizes option groups", () => {
    const listed = listMockupStylesFromPrintfiles(71, bella3001)
    expect(listed.catalogProductId).toBe(71)
    expect(listed.placements.map((p) => p.key)).toEqual(["front", "back"])
    expect(listed.optionGroups.find((g) => g.name === "Ghost")?.category).toBe("ghost")
    expect(categorizeMockupStyleName("Zoomed in")).toBe("closeup")
    expect(categorizeMockupStyleName("Product details")).toBe("detail")
  })

  it("plans Outkast gallery for Bella 3001 style names", () => {
    const plan = planOutkastGalleryStyles(bella3001.option_groups || [])
    expect(plan.ghostFront).toBe("Ghost")
    expect(plan.zoomedIn).toBe("Zoomed in")
    expect(plan.backGroup).toBe("Back")
    expect(plan.productDetails).toBe("Product details")
    const slots = outkastGallerySlotsFromPlan(plan)
    expect(slots.map((s) => s.slot)).toEqual([
      "ghost-front",
      "zoomed-in",
      "back",
      "product-details",
    ])
  })

  it("uses Flat when Back group is missing", () => {
    const plan = planOutkastGalleryStyles(["Ghost", "Flat", "Zoomed in"])
    expect(plan.backGroup).toBe("Flat")
  })
})
