import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { compositeMugWrapPng, planMugWrapComposite } from "../../lib/mug-wrap-composite"
import {
  extractFrontPanelArtFromWrap,
  isMugWrapImageDimensions,
} from "../../lib/mug-wrap-source-art"

async function meanRedInSquare(
  png: Buffer,
  centerX: number,
  centerY: number,
  halfSize: number
): Promise<number> {
  const meta = await sharp(png).metadata()
  const w = meta.width || 0
  const h = meta.height || 0
  const left = Math.max(0, Math.round(centerX - halfSize))
  const top = Math.max(0, Math.round(centerY - halfSize))
  const size = Math.min(halfSize * 2, w - left, h - top)
  const { data } = await sharp(png)
    .extract({ left, top, width: size, height: size })
    .raw()
    .toBuffer({ resolveWithObject: true })
  let sum = 0
  for (let i = 0; i < data.length; i += 4) {
    sum += data[i]
  }
  return sum / (data.length / 4)
}

describe("mug-wrap-source-art", () => {
  const dims = { areaWidth: 2700, areaHeight: 1050 }

  it("plans PR #14 layout: large art at 1/4 and 3/4 wrap centers", () => {
    const plan = planMugWrapComposite(dims)
    expect(plan.artSize).toBeGreaterThanOrEqual(0.4 * dims.areaHeight)
    expect(plan.frontCenterX).toBe(Math.round(dims.areaWidth / 4))
    expect(plan.backCenterX).toBe(Math.round((dims.areaWidth * 3) / 4))
    expect(plan.frontLeft + plan.artSize / 2).toBeCloseTo(plan.frontCenterX, 0)
    expect(plan.backLeft + plan.artSize / 2).toBeCloseTo(plan.backCenterX, 0)
  })

  it("detects full wrap dimensions", () => {
    expect(isMugWrapImageDimensions(2700, 1050)).toBe(true)
    expect(isMugWrapImageDimensions(800, 800)).toBe(false)
  })

  it("re-compositing a wrap shrinks art; extract panel restores full-size layout", async () => {
    const plan = planMugWrapComposite(dims)
    const singleArt = await sharp({
      create: {
        width: 500,
        height: 500,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer()

    const correctWrap = await compositeMugWrapPng(singleArt, dims)
    const nestedWrong = await compositeMugWrapPng(correctWrap, dims)

    const centerY = plan.top + Math.round(plan.artSize / 2)
    const correctRed = await meanRedInSquare(
      correctWrap,
      plan.frontCenterX,
      centerY,
      Math.round(plan.artSize * 0.2)
    )
    const nestedRed = await meanRedInSquare(
      nestedWrong,
      plan.frontCenterX,
      centerY,
      Math.round(plan.artSize * 0.2)
    )
    expect(correctRed).toBeGreaterThan(200)
    expect(nestedRed).toBeLessThan(correctRed * 0.85)

    const panel = await extractFrontPanelArtFromWrap(correctWrap, dims)
    const panelMeta = await sharp(panel).metadata()
    expect(panelMeta.width).toBe(plan.artSize)

    const restoredWrap = await compositeMugWrapPng(panel, dims)
    const restoredRed = await meanRedInSquare(
      restoredWrap,
      plan.frontCenterX,
      centerY,
      Math.round(plan.artSize * 0.2)
    )
    expect(restoredRed).toBeGreaterThan(correctRed * 0.85)
  })
})
