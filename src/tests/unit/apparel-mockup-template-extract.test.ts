import { describe, it, expect } from "vitest"
import {
  clampExtractRegion,
  computeTemplateArtRect,
  resolvePrintAreaExtractBox,
} from "../../lib/apparel-mockup-template-fallback"
import type { LayoutTemplate } from "../../lib/printful-mockup-config"

describe("apparel-mockup-template extract", () => {
  const template: LayoutTemplate = {
    template_id: 1,
    template_width: 800,
    template_height: 1000,
    print_area_width: 400,
    print_area_height: 500,
    print_area_left: 200,
    print_area_top: 150,
  }

  it("leftChest 563×563 @ (1219, 450) clamps inside 1800×2400 print PNG", () => {
    const position = {
      area_width: 1800,
      area_height: 2400,
      width: 563,
      height: 563,
      left: 1219,
      top: 450,
    }
    const extract = resolvePrintAreaExtractBox(1800, 2400, position)
    expect(extract.left).toBe(1219)
    expect(extract.top).toBe(450)
    expect(extract.width).toBe(563)
    expect(extract.height).toBe(563)

    const rect = computeTemplateArtRect(template, position)
    expect(rect.width).toBe(Math.round((563 / 1800) * 800))
    expect(rect.left).toBe(Math.round(200 + (1219 / 1800) * 400))
  })

  it("centred 1275 wide @ (263, 563) scales to print_area_width", () => {
    const position = {
      area_width: 1800,
      area_height: 2400,
      width: 1275,
      height: 1275,
      left: 263,
      top: 563,
    }
    const extract = resolvePrintAreaExtractBox(1800, 2400, position)
    expect(extract.width).toBe(1275)
    expect(extract.left).toBe(263)

    const rect = computeTemplateArtRect(template, position)
    expect(rect.width).toBe(Math.round((1275 / 1800) * 800))
    expect(rect.left).toBe(Math.round(200 + (263 / 1800) * 400))
  })

  it("clamps extract when coordinates exceed image bounds", () => {
    const clamped = clampExtractRegion(100, 100, { left: 90, top: 90, width: 50, height: 50 })
    expect(clamped.left).toBe(90)
    expect(clamped.top).toBe(90)
    expect(clamped.width).toBe(10)
    expect(clamped.height).toBe(10)
  })
})
