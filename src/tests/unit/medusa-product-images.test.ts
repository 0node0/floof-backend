import { describe, it, expect } from "vitest"
import {
  galleryUrlsChanged,
  isStockCatalogImageUrl,
  newLifestyleMockupUrlsAdded,
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

  it("imagesChanged only when new lifestyle URLs land in gallery", () => {
    const life = "https://files.cdn.printful.com/files/mock/life.jpg"
    const flat = "https://files.cdn.printful.com/files/art/flat.png"
    expect(newLifestyleMockupUrlsAdded([flat], [flat, life], [life])).toBe(true)
    expect(newLifestyleMockupUrlsAdded([life], [life, flat], [life])).toBe(false)
    expect(newLifestyleMockupUrlsAdded([flat], [flat], [life])).toBe(false)
  })
})

describe("buildMugProductGallery", () => {
  it("uses lifestyle-only gallery when lifestyle shots exist", () => {
    const gallery = buildMugProductGallery(
      [{ url: "https://cdn/life2.jpg", title: "Lifestyle 2" }],
      ["https://cdn/flat-art.png"],
      ["https://files.cdn.printful.com/products/19/stock.jpg"]
    )
    expect(gallery).toEqual(["https://cdn/life2.jpg"])
    expect(gallery.some((u) => u.includes("/products/19/"))).toBe(false)
  })

  it("falls back to flat art when no lifestyle shots", () => {
    const gallery = buildMugProductGallery([], ["https://cdn/flat-art.png"])
    expect(gallery).toEqual(["https://cdn/flat-art.png"])
  })
})
