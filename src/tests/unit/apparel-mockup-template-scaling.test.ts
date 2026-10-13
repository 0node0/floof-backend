import { describe, it, expect } from "vitest"
import { computeTemplateArtRect } from "../../lib/apparel-mockup-template-fallback"
import type { LayoutTemplate } from "../../lib/printful-mockup-config"

describe("apparel-mockup-template scaling", () => {
  it("centred 1275px art at left 263 scales to print_area_width/1800", () => {
    const template: LayoutTemplate = {
      template_id: 1,
      template_width: 800,
      template_height: 1000,
      print_area_width: 400,
      print_area_height: 500,
      print_area_left: 200,
      print_area_top: 150,
    }
    const printPosition = {
      area_width: 1800,
      area_height: 2400,
      width: 1275,
      height: 1275,
      left: 263,
      top: 563,
    }
    const rect = computeTemplateArtRect(template, printPosition)
    const scale = 400 / 1800
    expect(rect.width).toBe(Math.round(1275 * scale))
    expect(rect.left).toBe(Math.round(200 + 263 * scale))
    const centeredLeft = 200 + Math.round((400 - 1275 * scale) / 2)
    expect(Math.abs(rect.left - centeredLeft)).toBeLessThanOrEqual(1)
  })
})
