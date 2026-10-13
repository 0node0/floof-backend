import { describe, it, expect } from "vitest"
import sharp from "sharp"
import {
  compositeMugWrapPng,
  planMugWrapComposite,
} from "../../lib/mug-wrap-composite"
import {
  inkCrossesCenterSeam,
  validateMugWrapLayout,
} from "../../lib/mug-wrap-layout-guard"
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

  /** Many disconnected shapes — one union bbox (multi-part design). */
  async function multiPartArt(): Promise<Buffer> {
    const tile = await sharp({
      create: {
        width: 80,
        height: 80,
        channels: 4,
        background: { r: 30, g: 30, b: 200, alpha: 1 },
      },
    })
      .png()
      .toBuffer()

    const positions = [
      { left: 40, top: 40 },
      { left: 200, top: 60 },
      { left: 360, top: 120 },
      { left: 120, top: 280 },
      { left: 300, top: 320 },
    ]
    return sharp({
      create: {
        width: 500,
        height: 500,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(positions.map((p) => ({ input: tile, ...p })))
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
    expect(v.centerSeamInk).toBe(false)
  })

  it("accepts multi-part design (union bbox, not cluster count)", async () => {
    const art = await multiPartArt()
    const wrap = await compositeMugWrapPng(art, dims)
    const meta = await sharp(art).metadata()
    const plan = planMugWrapComposite(dims, meta.width || 500, meta.height || 500)
    const v = await validateMugWrapLayout(wrap, dims, plan)
    expect(v.ok).toBe(true)
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

  it("detects ink on center seam", async () => {
    const { data, info } = await sharp({
      create: {
        width: 100,
        height: 40,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 60,
              height: 20,
              channels: 4,
              background: { r: 255, g: 0, b: 0, alpha: 1 },
            },
          })
            .png()
            .toBuffer(),
          left: 35,
          top: 10,
        },
      ])
      .raw()
      .toBuffer({ resolveWithObject: true })

    expect(inkCrossesCenterSeam(data, info.width, info.height, 50)).toBe(true)
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
