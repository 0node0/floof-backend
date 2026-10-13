import { describe, it, expect } from "vitest"
import { resolveLayoutMap } from "../../lib/maintain-apparel-placements"

describe("maintain-apparel-placements input", () => {
  it("accepts mockupsOnly flag in input type", () => {
    const map = resolveLayoutMap({
      mockupsOnly: true,
      layouts: { prod_1: "leftChest" },
    })
    expect(map.get("prod_1")).toBe("leftChest")
  })

  it("resolves layouts from products array and layouts map", () => {
    const map = resolveLayoutMap({
      products: [{ productId: "a", layout: "leftChest" }],
      layouts: { b: "centred" },
      productIds: ["c"],
    })
    expect(map.get("a")).toBe("leftChest")
    expect(map.get("b")).toBe("centred")
  })
})
