import { describe, it, expect } from "vitest"
import {
  APPAREL_PRINT_DPI,
  buildCentredBackPosition,
  buildCentredFrontPosition,
  buildLeftChestPosition,
  inchesToPrintPixels,
  planApparelPlacementLayout,
} from "../../lib/apparel-placement-layout"

describe("apparel-placement-layout", () => {
  it("converts inches at 300 DPI", () => {
    expect(inchesToPrintPixels(1)).toBe(300)
    expect(APPAREL_PRINT_DPI).toBe(300)
  })

  it("places left chest to the right of centre", () => {
    const areaW = 3600
    const areaH = 4800
    const pos = buildLeftChestPosition(areaW, areaH)
    const centerX = areaW / 2
    const artCenterX = pos.left + pos.width / 2
    expect(artCenterX).toBeGreaterThan(centerX)
    expect(pos.top).toBe(inchesToPrintPixels(3))
  })

  it("raises centred hoodie art vs tee", () => {
    const areaW = 3600
    const areaH = 4800
    const tee = buildCentredFrontPosition(areaW, areaH, false)
    const hoodie = buildCentredFrontPosition(areaW, areaH, true)
    expect(hoodie.top).toBeLessThan(tee.top)
  })

  it("plans chestPlusBack with front and back placements", () => {
    const plan = planApparelPlacementLayout(
      "chestPlusBack",
      {
        printfiles: [
          { printfile_id: 1, width: 3600, height: 4800, placement: "front" },
          { printfile_id: 2, width: 3600, height: 4800, placement: "back" },
        ],
        variant_printfiles: [{ variant_id: 1, placements: { front: 1, back: 2 } }],
      },
      [1],
      false
    )
    expect(plan.placements).toHaveLength(2)
    expect(plan.placements.map((p) => p.placement)).toEqual(["front", "back"])
    const back = buildCentredBackPosition(3600, 4800)
    expect(plan.placements[1].position.width).toBe(back.width)
  })
})
