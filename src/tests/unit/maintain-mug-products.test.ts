import { describe, it, expect } from "vitest"
import { looksLikeMug } from "../../lib/maintain-mug-products"

describe("maintain-mug-products", () => {
  it("detects mugs by title and metadata", () => {
    expect(looksLikeMug({ title: "Ceramic Mug", handle: "ceramic-mug" })).toBe(true)
    expect(looksLikeMug({ title: "Humidity Club", handle: "humidity-club" })).toBe(false)
    expect(
      looksLikeMug({
        title: "Tote",
        handle: "tote",
        metadata: { printful_catalog_product_id: 19 },
      })
    ).toBe(true)
  })
})
