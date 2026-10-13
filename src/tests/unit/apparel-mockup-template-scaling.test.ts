import { describe, it, expect } from "vitest"
import {
  computeTemplateArtRect,
  templateArtWidthInchesToPx,
} from "../../lib/apparel-mockup-template-fallback"
import type { LayoutTemplate } from "../../lib/printful-mockup-config"
import { buildLeftChestPosition } from "../../lib/apparel-placement-layout"

describe("apparel-mockup-template scaling", () => {
  const bellaTemplate: LayoutTemplate = {
    template_id: 1,
    template_width: 544,
    template_height: 680,
    print_area_width: 256,
    print_area_height: 320,
    print_area_left: 144,
    print_area_top: 120,
  }

  it("left-chest 3.75in art is 3.75/12 of print_area_width (~80px), not shirt width", () => {
    const position = buildLeftChestPosition(1800, 2400)
    const rect = computeTemplateArtRect(bellaTemplate, position)
    const expectedW = templateArtWidthInchesToPx(bellaTemplate, 3.75)
    expect(expectedW).toBe(Math.round((3.75 / 12) * 256))
    expect(rect.width).toBe(expectedW)
    expect(rect.width).toBeLessThan(100)
    expect(rect.width).not.toBeGreaterThan(120)
  })

  it("art rect stays inside template print_area bounds", () => {
    const position = buildLeftChestPosition(1800, 2400)
    const rect = computeTemplateArtRect(bellaTemplate, position)
    const paL = bellaTemplate.print_area_left!
    const paT = bellaTemplate.print_area_top!
    const paW = bellaTemplate.print_area_width!
    const paH = bellaTemplate.print_area_height!
    expect(rect.left).toBeGreaterThanOrEqual(paL)
    expect(rect.top).toBeGreaterThanOrEqual(paT)
    expect(rect.left + rect.width).toBeLessThanOrEqual(paL + paW + 1)
    expect(rect.top + rect.height).toBeLessThanOrEqual(paT + paH + 1)
  })
})
