import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { compositeMugWrapPng, planMugWrapComposite } from "../../lib/mug-wrap-composite"
import { validateMugWrapLayout } from "../../lib/mug-wrap-layout-guard"
import { MugWrapSourceRefusedError } from "../../lib/mug-wrap-source-art"
import { fetchAndAssertSingleSidedDesignPng } from "../../lib/mug-design-source"

describe("mug-wrap-layout-guard", () => {
  const dims = { areaWidth: 2700, areaHeight: 1050 }

  async function solidSquareArt(): Promise<Buffer> {
    return sharp({
      create: {
        width: 500,
        height: 500,
        channels: 4,
        background: { r: 200, g: 40, b: 40, alpha: 1 },
      },
    })
      .png()
      .toBuffer()
  }

  it("accepts PR #14 dual-panel composite", async () => {
    const art = await solidSquareArt()
    const wrap = await compositeMugWrapPng(art, dims)
    const v = await validateMugWrapLayout(wrap, dims)
    expect(v.ok).toBe(true)
    expect(v.leftInkHeight).toBeGreaterThanOrEqual(0.6 * dims.areaHeight)
    expect(v.rightInkHeight).toBeGreaterThanOrEqual(0.6 * dims.areaHeight)
  })

  it("rejects nested wrap (tiny duplicate art)", async () => {
    const art = await solidSquareArt()
    const correct = await compositeMugWrapPng(art, dims)
    const bad = await compositeMugWrapPng(correct, dims)
    const v = await validateMugWrapLayout(bad, dims)
    expect(v.ok).toBe(false)
  })

  it("refuses bad wrap URL as design input instead of re-compositing", async () => {
    const art = await solidSquareArt()
    const badWrap = await compositeMugWrapPng(art, dims)
    const dataUrl = `data:image/png;base64,${badWrap.toString("base64")}`
    await expect(fetchAndAssertSingleSidedDesignPng(dataUrl)).rejects.toBeInstanceOf(
      MugWrapSourceRefusedError
    )
  })

  it("PR #14 plan still places art at 1/4 and 3/4", () => {
    const plan = planMugWrapComposite(dims)
    expect(plan.artSize).toBeGreaterThanOrEqual(0.4 * dims.areaHeight)
    expect(plan.frontCenterX).toBe(Math.round(dims.areaWidth / 4))
    expect(plan.backCenterX).toBe(Math.round((dims.areaWidth * 3) / 4))
  })
})
