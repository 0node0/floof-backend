import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { buildLeftChestPosition } from "../../lib/apparel-placement-layout"
import {
  computeGenerousPlacementRegionOnMockup,
  mockupPixelDifference,
  mockupPixelDifferenceInRegion,
  mockupShowsDesign,
  mockupShowsDesignInRegion,
  validateMockupArtVisibility,
} from "../../lib/apparel-mockup-validation"

describe("apparel-mockup-validation", () => {
  it("detects visible design vs blank garment (full frame)", async () => {
    const blank = await sharp({
      create: { width: 120, height: 120, channels: 3, background: { r: 200, g: 200, b: 200 } },
    })
      .jpeg()
      .toBuffer()
    const withDesign = await sharp(blank)
      .composite([
        {
          input: await sharp({
            create: { width: 40, height: 40, channels: 3, background: { r: 20, g: 80, b: 220 } },
          })
            .png()
            .toBuffer(),
          left: 40,
          top: 40,
        },
      ])
      .jpeg()
      .toBuffer()

    const same = await mockupPixelDifference(blank, blank)
    expect(mockupShowsDesign(same)).toBe(false)

    const diff = await mockupPixelDifference(withDesign, blank)
    expect(mockupShowsDesign(diff)).toBe(true)
  })

  it("left-chest 3.75in box passes in-box validation when full-frame diff is tiny", async () => {
    const leftChest = buildLeftChestPosition(1800, 2400)
    expect(leftChest.width).toBe(563)
    expect(leftChest.left).toBe(1219)
    expect(leftChest.top).toBe(450)

    const iw = 1200
    const ih = 1600
    const blank = await sharp({
      create: { width: iw, height: ih, channels: 3, background: { r: 210, g: 205, b: 200 } },
    })
      .jpeg()
      .toBuffer()

    const region = computeGenerousPlacementRegionOnMockup(iw, ih, leftChest)
    const artW = Math.round((leftChest.width / 1800) * iw)
    const artH = Math.round((leftChest.height / 2400) * ih)
    const artLeft = Math.round((leftChest.left / 1800) * iw)
    const artTop = Math.round((leftChest.top / 2400) * ih)

    const withDesign = await sharp(blank)
      .composite([
        {
          input: await sharp({
            create: {
              width: artW,
              height: artH,
              channels: 3,
              background: { r: 25, g: 90, b: 210 },
            },
          })
            .png()
            .toBuffer(),
          left: artLeft,
          top: artTop,
        },
      ])
      .jpeg()
      .toBuffer()

    const full = await mockupPixelDifference(withDesign, blank)
    const inBox = await mockupPixelDifferenceInRegion(withDesign, blank, region)
    expect(inBox.ratio).toBeGreaterThan(full.ratio)
    expect(mockupShowsDesignInRegion(inBox)).toBe(true)
    expect(mockupShowsDesign(full)).toBe(full.ratio >= 0.008)

    const verdict = await validateMockupArtVisibility(withDesign, blank, leftChest)
    expect(verdict.passed).toBe(true)
    expect(verdict.inBoxRatio).toBeGreaterThan(verdict.fullFrameRatio * 4)
  })
})
