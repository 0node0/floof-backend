import { describe, it, expect } from "vitest"
import {
  buildCentredBackPosition,
  buildCentredFrontPosition,
  buildLeftChestPosition,
  clampPrintPosition,
  planApparelPlacementLayout,
  resolvePrintAreaDpi,
} from "../../lib/apparel-placement-layout"

const AREA_W = 1800
const AREA_H = 2400

describe("apparel-placement-layout @ 1800×2400 (150 DPI)", () => {
  it("resolves 150 DPI for standard Printful apparel print area", () => {
    expect(resolvePrintAreaDpi(AREA_W, AREA_H)).toBe(150)
  })

  it("leftChest: 3.75″ wide, 3″ top, centre 4″ toward wearer's left of chest centre", () => {
    const pos = buildLeftChestPosition(AREA_W, AREA_H)
    expect(pos.area_width).toBe(1800)
    expect(pos.area_height).toBe(2400)
    expect(pos.width).toBe(563)
    expect(pos.height).toBe(563)
    expect(pos.top).toBe(450)
    expect(pos.left).toBeGreaterThanOrEqual(1218)
    expect(pos.left).toBeLessThanOrEqual(1219)
    const artCenter = pos.left + pos.width / 2
    expect(artCenter).toBeGreaterThan(1499)
    expect(artCenter).toBeLessThan(1501)
    expect(pos.left + pos.width).toBeLessThanOrEqual(AREA_W)
    expect(pos.top + pos.height).toBeLessThanOrEqual(AREA_H)
  })

  it("centred tee: 8.5″ wide, horizontally centred", () => {
    const pos = buildCentredFrontPosition(AREA_W, AREA_H, false)
    expect(pos.width).toBe(1275)
    expect(pos.height).toBe(1275)
    expect(pos.left).toBe(263)
    expect(pos.top).toBe(563)
    expect(pos.left + pos.width).toBeLessThanOrEqual(AREA_W)
  })

  it("centred hoodie sits higher than tee", () => {
    const tee = buildCentredFrontPosition(AREA_W, AREA_H, false)
    const hoodie = buildCentredFrontPosition(AREA_W, AREA_H, true)
    expect(hoodie.top).toBe(300)
    expect(hoodie.top).toBeLessThan(tee.top)
    expect(hoodie.width).toBe(1275)
  })

  it("back print: 10.5″ centred", () => {
    const pos = buildCentredBackPosition(AREA_W, AREA_H)
    expect(pos.width).toBe(1575)
    expect(pos.left).toBe(113)
    expect(pos.top).toBe(413)
  })

  it("chestPlusBack front uses wearer's left chest (same box as leftChest)", () => {
    const left = buildLeftChestPosition(AREA_W, AREA_H)
    const plan = planApparelPlacementLayout(
      "chestPlusBack",
      {
        printfiles: [
          { printfile_id: 1, width: AREA_W, height: AREA_H, placement: "front" },
          { printfile_id: 2, width: AREA_W, height: AREA_H, placement: "back" },
        ],
        variant_printfiles: [{ variant_id: 1, placements: { front: 1, back: 2 } }],
      },
      [1],
      false
    )
    expect(plan.placements[0].position.left).toBe(left.left)
    expect(plan.placements[0].position.top).toBe(450)
    expect(plan.placements[0].position.width).toBe(563)
  })

  it("clamps oversized boxes inside print area", () => {
    const clamped = clampPrintPosition({
      area_width: 1800,
      area_height: 2400,
      width: 3000,
      height: 3000,
      left: -100,
      top: 5000,
    })
    expect(clamped.width).toBeLessThanOrEqual(1800)
    expect(clamped.height).toBeLessThanOrEqual(2400)
    expect(clamped.left).toBeGreaterThanOrEqual(0)
    expect(clamped.top).toBeGreaterThanOrEqual(0)
    expect(clamped.left + clamped.width).toBeLessThanOrEqual(1800)
    expect(clamped.top + clamped.height).toBeLessThanOrEqual(2400)
  })

  it("plans chestPlusBack with inch metadata", () => {
    const plan = planApparelPlacementLayout(
      "chestPlusBack",
      {
        printfiles: [
          { printfile_id: 1, width: AREA_W, height: AREA_H, placement: "front" },
          { printfile_id: 2, width: AREA_W, height: AREA_H, placement: "back" },
        ],
        variant_printfiles: [{ variant_id: 1, placements: { front: 1, back: 2 } }],
      },
      [1],
      false
    )
    expect(plan.planned).toHaveLength(2)
    expect(plan.planned[0].inches.width).toBeCloseTo(3.75, 2)
    expect(plan.planned[1].inches.width).toBeCloseTo(10.5, 2)
  })
})
