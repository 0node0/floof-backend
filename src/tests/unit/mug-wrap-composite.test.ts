import { describe, it, expect } from "vitest"
import sharp from "sharp"
import {
  buildMugWrapFullBleedPosition,
  compositeMugWrapPng,
  mugWrapArtPixelSize,
  mugWrapPanelCenters,
} from "../../lib/mug-wrap-composite"

describe("mug-wrap-composite", () => {
  it("places art panels at quarter and three-quarter wrap positions", () => {
    const c = mugWrapPanelCenters(2700)
    expect(c.front).toBe(675)
    expect(c.back).toBe(2025)
    const size = mugWrapArtPixelSize(2700, 1050)
    expect(size).toBeLessThan(2700 * 0.5)
  })

  it("uses full bleed position for composited wrap file", () => {
    const pos = buildMugWrapFullBleedPosition(2700, 1050)
    expect(pos).toMatchObject({
      area_width: 2700,
      area_height: 1050,
      width: 2700,
      height: 1050,
      left: 0,
      top: 0,
    })
  })

  it("composites two panels onto a wrap canvas", async () => {
    const design = await sharp({
      create: { width: 200, height: 200, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    })
      .png()
      .toBuffer()

    const wrap = await compositeMugWrapPng(design, { areaWidth: 800, areaHeight: 400 })
    const meta = await sharp(wrap).metadata()
    expect(meta.width).toBe(800)
    expect(meta.height).toBe(400)
    expect(wrap.length).toBeGreaterThan(500)
  })
})
