import { describe, it, expect, vi, beforeEach } from "vitest"
import { applyApparelProductGallery } from "../../lib/maintain-apparel-placements"
import { ensureDurableGalleryImageUrl } from "../../lib/durable-public-image"
import { replaceProductGalleryImages } from "../../lib/medusa-product-images"

vi.mock("../../lib/durable-public-image", () => ({
  ensureDurableGalleryImageUrl: vi.fn(async (_url: string) => `durable:${_url}`),
}))

vi.mock("../../lib/medusa-product-images", () => ({
  replaceProductGalleryImages: vi.fn(async () => ({
    previousUrls: [],
    nextUrls: ["durable:https://a.jpg", "durable:https://b.jpg"],
    imagesChanged: true,
    thumbnailChanged: true,
  })),
}))

describe("applyApparelProductGallery", () => {
  beforeEach(() => {
    vi.stubEnv("PRINTFUL_API_TOKEN", "test-token")
    vi.mocked(ensureDurableGalleryImageUrl).mockClear()
    vi.mocked(replaceProductGalleryImages).mockClear()
  })

  it("rehosts URLs and replaces gallery", async () => {
    const container = {} as import("@medusajs/framework/types").MedusaContainer
    const result = await applyApparelProductGallery(container, {
      productId: "prod_1",
      imageUrls: ["https://a.jpg", "https://b.jpg"],
    })

    expect(ensureDurableGalleryImageUrl).toHaveBeenCalledTimes(2)
    expect(replaceProductGalleryImages).toHaveBeenCalledWith(
      container,
      "prod_1",
      ["durable:https://a.jpg", "durable:https://b.jpg"],
      "durable:https://a.jpg"
    )
    expect(result.imagesChanged).toBe(true)
    expect(result.rehostedUrls).toHaveLength(2)
  })

  it("requires productId and imageUrls", async () => {
    const container = {} as import("@medusajs/framework/types").MedusaContainer
    await expect(
      applyApparelProductGallery(container, { productId: "", imageUrls: [] })
    ).rejects.toThrow(/productId/)
  })
})
