import { describe, it, expect } from "vitest"
import { computeTemplateArtRect } from "../../lib/apparel-mockup-template-fallback"
import type { LayoutTemplate } from "../../lib/printful-mockup-config"

describe("apparel-mockup-template scaling", () => {
  const template: LayoutTemplate = {
    template_id: 1,
    template_width: 800,
    template_height: 1000,
    print_area_width: 400,
    print_area_height: 500,
    print_area_left: 200,
    print_area_top: 150,
  }

  it("leftChest 563×563 @ (1219, 450) scales art to shirt width (3.75in on ~544px shirt)", () => {
    const printPosition = {
      area_width: 1800,
      area_height: 2400,
      width: 563,
      height: 563,
      left: 1219,
      top: 450,
    }
    const rect = computeTemplateArtRect(template, printPosition)
    expect(rect.width).toBe(Math.round((563 / 1800) * 800))
    expect(rect.width).toBeGreaterThan(150)
    expect(rect.left).toBe(Math.round(200 + (1219 / 1800) * 400))
  })

  it("centred 1275 wide @ (263, 563) uses template_width for art size", () => {
    const printPosition = {
      area_width: 1800,
      area_height: 2400,
      width: 1275,
      height: 1275,
      left: 263,
      top: 563,
    }
    const rect = computeTemplateArtRect(template, printPosition)
    expect(rect.width).toBe(Math.round((1275 / 1800) * 800))
    expect(rect.left).toBe(Math.round(200 + (263 / 1800) * 400))
  })
})
