import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { compositeDesignIntoPrintArea } from "../../lib/apparel-print-file"
import { buildCentredFrontPosition } from "../../lib/apparel-placement-layout"

describe("apparel-print-file composite", () => {
  it("fits large art inside 1800×2400 centred box without sharp overflow", async () => {
    const design = await sharp({
      create: { width: 4000, height: 4000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer()
    const position = buildCentredFrontPosition(1800, 2400, false)
    const { png } = await compositeDesignIntoPrintArea(design, position)
    const meta = await sharp(png).metadata()
    expect(meta.width).toBe(1800)
    expect(meta.height).toBe(2400)
  })
})
