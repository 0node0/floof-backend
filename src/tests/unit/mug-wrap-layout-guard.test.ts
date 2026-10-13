import { describe, it, expect } from "vitest"
import sharp from "sharp"
import {
  compositeMugWrapPng,
  planMugWrapComposite,
} from "../../lib/mug-wrap-composite"
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

  async function wideArt(): Promise<Buffer> {
    return sharp({
      create: {
        width: 1200,
        height: 280,
        channels: 4,
        background: { r: 10, g: 120, b: 200, alpha: 1 },
      },
    })
      .png()
      .toBuffer()
  }

  it("accepts dual-panel composite with identical halves", async () => {
    const art = await solidSquareArt()
    const wrap = await compositeMugWrapPng(art, dims)
    const meta = await sharp(art).metadata()
    const plan = planMugWrapComposite(dims, meta.width || 500, meta.height || 500)
    const v = await validateMugWrapLayout(wrap, dims, plan)
    expect(v.ok).toBe(true)
    expect(v.halvesIdentical).toBe(true)
  })

  it("accepts wide designs sized to half-panel fit", async () => {
    const art = await wideArt()
    const wrap = await compositeMugWrapPng(art, dims)
    const meta = await sharp(art).metadata()
    const plan = planMugWrapComposite(dims, meta.width || 1200, meta.height || 280)
    const v = await validateMugWrapLayout(wrap, dims, plan)
    expect(v.ok).toBe(true)
    expect(plan.artHeight).toBeLessThan(0.6 * dims.areaHeight)
  })

  it("rejects nested wrap (tiny duplicate art)", async () => {
    const art = await solidSquareArt()
    const correct = await compositeMugWrapPng(art, dims)
    const bad = await compositeMugWrapPng(correct, dims)
    const meta = await sharp(art).metadata()
    const plan = planMugWrapComposite(dims, meta.width || 500, meta.height || 500)
    const v = await validateMugWrapLayout(bad, dims, plan)
    expect(v.ok).toBe(false)
  })

  it("rejects mirrored back panel", async () => {
    const art = await sharp({
      create: {
        width: 400,
        height: 400,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 200,
              height: 400,
              channels: 4,
              background: { r: 255, g: 0, b: 0, alpha: 1 },
            },
          })
            .png()
            .toBuffer(),
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer()

    const plan = planMugWrapComposite(dims, 400, 400)
    const resized = await sharp(art)
      .resize(plan.artWidth, plan.artHeight, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer()
    const mirrored = await sharp(resized).flop().toBuffer()
    const badWrap = await sharp({
      create: {
        width: dims.areaWidth,
        height: dims.areaHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        { input: resized, left: plan.frontLeft, top: plan.top },
        { input: mirrored, left: plan.backLeft, top: plan.top },
      ])
      .png()
      .toBuffer()

    const v = await validateMugWrapLayout(badWrap, dims, plan)
    expect(v.ok).toBe(false)
    expect(v.halvesIdentical).toBe(false)
  })

  it("refuses bad wrap URL as design input", async () => {
    const art = await solidSquareArt()
    const badWrap = await compositeMugWrapPng(art, dims)
    const dataUrl = `data:image/png;base64,${badWrap.toString("base64")}`
    await expect(fetchAndAssertSingleSidedDesignPng(dataUrl)).rejects.toBeInstanceOf(
      MugWrapSourceRefusedError
    )
  })
})
