import { describe, it, expect } from "vitest"
import {
  countProductGalleryImages,
  looksLikeMug,
  productMatchesRegenerateList,
} from "../../lib/maintain-mug-products"

describe("maintain-mug-products", () => {
  it("matches regenerate list by id, handle, or title", () => {
    const p = { id: "prod_1", handle: "pro-snuggler", title: "Professional Snuggler" }
    expect(productMatchesRegenerateList(p, ["Professional Snuggler"])).toBe(true)
    expect(productMatchesRegenerateList(p, ["pro-snuggler"])).toBe(true)
    expect(productMatchesRegenerateList(p, ["prod_1"])).toBe(true)
  })

  it("counts unique gallery URLs", () => {
    expect(countProductGalleryImages({ images: [{ url: "a" }, { url: "a" }] })).toBe(1)
    expect(countProductGalleryImages({ images: [{ url: "a" }, { url: "b" }] })).toBe(2)
  })

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
