import { describe, it, expect } from "vitest"
import {
  buildApparelMockupFilePayload,
  isFullBleedMockupPosition,
  isPreviewArtworkUrl,
  mockupCreateOptionsForPlacement,
} from "../../lib/printful-mockup-request"
import { buildApparelFullBleedPosition } from "../../lib/apparel-placement-layout"

describe("printful-mockup-request", () => {
  const leftChest = {
    area_width: 1800,
    area_height: 2400,
    width: 450,
    height: 450,
    top: 300,
    left: 619,
  }

  it("uses design artwork URL and art-box position (Printful mockup-generator contract)", () => {
    const payload = buildApparelMockupFilePayload({
      placement: "front",
      designSourceUrl: "https://cdn.example.com/design-source.png",
      printPosition: leftChest,
    })
    expect(payload.placement).toBe("front")
    expect(payload.image_url).toBe("https://cdn.example.com/design-source.png")
    expect(payload.position.width).toBe(450)
    expect(payload.position.left).toBe(619)
    expect(payload.position.limit_to_print_area).toBe(true)
    expect(isFullBleedMockupPosition(payload.position)).toBe(false)
  })

  it("rejects preview artwork URLs for mockup payloads", () => {
    expect(isPreviewArtworkUrl("https://cdn.example.com/foo_preview.png")).toBe(true)
    expect(() =>
      buildApparelMockupFilePayload({
        placement: "front",
        designSourceUrl: "https://cdn.example.com/foo_preview.png",
        printPosition: leftChest,
      })
    ).toThrow(/preview/)
  })

  it("requests Back option for back placement mockups", () => {
    expect(mockupCreateOptionsForPlacement("back")).toEqual(["Back"])
    expect(mockupCreateOptionsForPlacement("front")).toBeUndefined()
  })

  it("documents root cause: composited print-area PNG + full-bleed position yields blank mockups", () => {
    const wrongPosition = buildApparelFullBleedPosition(1800, 2400)
    expect(isFullBleedMockupPosition(wrongPosition)).toBe(true)
    const wrongRequest = {
      placement: "front",
      image_url: "https://files.printful.com/composited-mostly-transparent.png",
      position: wrongPosition,
    }
    expect(isFullBleedMockupPosition(wrongRequest.position)).toBe(true)
    expect(wrongRequest.image_url).toContain("composited")

    const fixed = buildApparelMockupFilePayload({
      placement: "front",
      designSourceUrl: "https://cdn.example.com/art.png",
      printPosition: leftChest,
    })
    expect(fixed.image_url).not.toBe(wrongRequest.image_url)
    expect(isFullBleedMockupPosition(fixed.position)).toBe(false)
  })
})
