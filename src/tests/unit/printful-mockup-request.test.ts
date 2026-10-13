import { describe, it, expect } from "vitest"
import {
  buildApparelMockupFilePayload,
  isArtworkLargeEnoughForMockup,
  isFullBleedMockupPosition,
  mockupCreateOptionsForPlacement,
  rejectArtworkForMockup,
  urlLooksLikePreviewArtworkPath,
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

  const previewNamedFullSize =
    "https://files.printful.com/files/abc/foo_preview.png"

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

  it("accepts _preview.png URLs when Printful file dimensions are large enough", () => {
    expect(urlLooksLikePreviewArtworkPath(previewNamedFullSize)).toBe(true)
    expect(isArtworkLargeEnoughForMockup({ width: 4500, height: 4424 })).toBe(true)
    expect(rejectArtworkForMockup(previewNamedFullSize, { width: 4500, height: 4424 })).toBe(
      null
    )
    const payload = buildApparelMockupFilePayload({
      placement: "front",
      designSourceUrl: previewNamedFullSize,
      printPosition: leftChest,
      artworkWidth: 4500,
      artworkHeight: 4424,
    })
    expect(payload.image_url).toBe(previewNamedFullSize)
  })

  it("rejects preview-looking URLs when dimensions are actually small", () => {
    expect(rejectArtworkForMockup(previewNamedFullSize, { width: 800, height: 800 })).toMatch(
      /too small/i
    )
    expect(() =>
      buildApparelMockupFilePayload({
        placement: "front",
        designSourceUrl: previewNamedFullSize,
        printPosition: leftChest,
        artworkWidth: 800,
        artworkHeight: 800,
      })
    ).toThrow(/too small/i)
  })

  it("rejects preview-looking URLs without known dimensions", () => {
    expect(rejectArtworkForMockup(previewNamedFullSize)).toMatch(/preview/i)
    expect(() =>
      buildApparelMockupFilePayload({
        placement: "front",
        designSourceUrl: previewNamedFullSize,
        printPosition: leftChest,
      })
    ).toThrow(/preview/i)
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
