import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { scaleToFitBox, trimTransparentPng } from "../../lib/apparel-art-prep"
import { compositeDesignIntoPrintArea } from "../../lib/apparel-print-file"
import { buildCentredFrontPosition, buildCentredBackPosition } from "../../lib/apparel-placement-layout"

describe("apparel-art-prep", () => {
  it("scaleToFitBox fills limiting dimension", () => {
    expect(scaleToFitBox(2000, 1000, 1275, 1275)).toEqual({ width: 1275, height: 638 })
    expect(scaleToFitBox(1000, 1000, 1575, 1575)).toEqual({ width: 1575, height: 1575 })
  })

  it("trims padding then scales centred art to full box width", async () => {
    const pad = 400
    const core = 200
    const design = await sharp({
      create: {
        width: pad * 2 + core,
        height: pad * 2 + core,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: core,
              height: core,
              channels: 4,
              background: { r: 255, g: 0, b: 0, alpha: 255 },
            },
          })
            .png()
            .toBuffer(),
          left: pad,
          top: pad,
        },
      ])
      .png()
      .toBuffer()

    const position = buildCentredFrontPosition(1800, 2400, false)
    const { renderedWidth } = await compositeDesignIntoPrintArea(design, position)
    expect(renderedWidth).toBe(1275)
  })

  it("scales back art to 1575px box width for square art", async () => {
    const design = await sharp({
      create: { width: 500, height: 500, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 255 } },
    })
      .png()
      .toBuffer()
    const position = buildCentredBackPosition(1800, 2400)
    const { renderedWidth } = await compositeDesignIntoPrintArea(design, position)
    expect(renderedWidth).toBe(1575)
  })
})
