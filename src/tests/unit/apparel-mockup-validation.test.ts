import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { mockupPixelDifference, mockupShowsDesign } from "../../lib/apparel-mockup-validation"

describe("apparel-mockup-validation", () => {
  it("detects visible design vs blank garment", async () => {
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
})
