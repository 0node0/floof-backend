import { describe, it, expect } from "vitest"
import { buildDrinkwareLifestyleGallery } from "../../lib/printful-mockup-config"
import { drinkwareGallerySortScore } from "../../lib/mug-mockup-scene-runner"

describe("mug-mockup-scene-runner", () => {
  it("ranks handheld close-up before woman holding", () => {
    expect(drinkwareGallerySortScore("Lifestyle 2 · mockup")).toBeLessThan(
      drinkwareGallerySortScore("Lifestyle · mockup")
    )
    const gallery = buildDrinkwareLifestyleGallery([
      { url: "https://a/woman.jpg", title: "Lifestyle · mockup" },
      { url: "https://a/hand.jpg", title: "Lifestyle 2 · mockup" },
    ])
    expect(gallery[0]).toBe("https://a/hand.jpg")
  })
})
