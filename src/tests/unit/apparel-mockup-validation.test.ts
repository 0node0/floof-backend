import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { buildCentredBackPosition, buildLeftChestPosition } from "../../lib/apparel-placement-layout"
import {
  computeInBoxPassThreshold,
  computeTightPlacementRegionOnMockup,
  mockupInBoxDiffPasses,
  mockupPixelDifference,
  mockupPixelDifferenceInRegion,
  mockupShowsDesign,
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

  it("left-chest region is ~1.3× art box, not hundreds of px oversized (prod ~1000px mockups)", () => {
    const leftChest = buildLeftChestPosition(1800, 2400)
    const iw = 1000
    const ih = 1000
    const region = computeTightPlacementRegionOnMockup(iw, ih, leftChest)
    const artW = (leftChest.width / 1800) * iw
    const artH = (leftChest.height / 2400) * ih
    expect(region.width).toBeLessThan(artW * 1.31)
    expect(region.width).toBeGreaterThan(artW * 0.95)
    expect(region.height).toBeLessThan(artH * 1.31)
    expect(region.width).toBeLessThan(448)
    expect(region.height).toBeLessThan(422)
  })

  it("prod log in-box ratios: left chest 1.0–2.7% passes; blank ~0.4% fails", () => {
    const leftChest = buildLeftChestPosition(1800, 2400)
    const threshold = computeInBoxPassThreshold(leftChest)
    expect(threshold).toBeLessThanOrEqual(0.01)
    expect(mockupInBoxDiffPasses(0.027, leftChest)).toBe(true)
    expect(mockupInBoxDiffPasses(0.01, leftChest)).toBe(true)
    expect(mockupInBoxDiffPasses(0.004, leftChest)).toBe(false)
  })

  it("back placement uses tight region, not full 1000×1000 frame", () => {
    const back = buildCentredBackPosition(1800, 2400)
    const region = computeTightPlacementRegionOnMockup(1000, 1000, back)
    expect(region.width * region.height).toBeLessThan(1000 * 1000 * 0.92)
    const threshold = computeInBoxPassThreshold(back)
    expect(mockupInBoxDiffPasses(0.045, back)).toBe(true)
    expect(mockupInBoxDiffPasses(0.003, back)).toBe(false)
  })

  it("left-chest lifestyle simulation passes validateMockupArtVisibility", async () => {
    const leftChest = buildLeftChestPosition(1800, 2400)
    const iw = 1000
    const ih = 1000
    const blank = await sharp({
      create: { width: iw, height: ih, channels: 3, background: { r: 210, g: 205, b: 200 } },
    })
      .jpeg()
      .toBuffer()

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

    const verdict = await validateMockupArtVisibility(withDesign, blank, leftChest)
    expect(verdict.passed).toBe(true)
    expect(verdict.inBoxRatio).toBeGreaterThan(verdict.passThreshold)
  })
})
