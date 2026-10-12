import { describe, it, expect } from "vitest"
import {
  galleryUrlsChanged,
  isStockCatalogImageUrl,
} from "../../lib/medusa-product-images"
import { buildMugProductGallery } from "../../lib/printful-mockup-config"

describe("medusa-product-images", () => {
  it("detects stock catalog image URLs", () => {
    expect(
      isStockCatalogImageUrl("https://files.cdn.printful.com/products/71/5309.jpg")
    ).toBe(true)
    expect(isStockCatalogImageUrl("https://files.cdn.printful.com/files/abc.jpg")).toBe(
      false
    )
  })

  it("detects gallery URL changes", () => {
    expect(galleryUrlsChanged(["a", "b"], ["a", "b"])).toBe(false)
    expect(galleryUrlsChanged(["a"], ["a", "b"])).toBe(true)
    expect(galleryUrlsChanged(["a", "b"], ["b", "a"])).toBe(true)
  })
})

describe("buildMugProductGallery", () => {
  it("orders lifestyle before flat art and drops stock URLs", () => {
    const gallery = buildMugProductGallery(
      [{ url: "https://cdn/life2.jpg", title: "Lifestyle 2" }],
      ["https://cdn/flat-art.png"],
      ["https://files.cdn.printful.com/products/19/stock.jpg"]
    )
    expect(gallery[0]).toBe("https://cdn/life2.jpg")
    expect(gallery).toContain("https://cdn/flat-art.png")
    expect(gallery.some((u) => u.includes("/products/19/"))).toBe(false)
  })
})
