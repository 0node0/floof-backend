import { describe, it, expect } from "vitest"
import {
  resolveMockupPlacement,
  resolveSyncFileType,
  selectMockupOptionBatches,
  stripFloofProductTitle,
  buildCenteredPrintPosition,
} from "../../lib/printful-mockup-config"

describe("printful-mockup-config", () => {
  it("resolves front for apparel and default for mugs", () => {
    expect(resolveMockupPlacement({ front: "Front", back: "Back" })).toBe("front")
    expect(resolveMockupPlacement({ default: "Print" })).toBe("default")
  })

  it("maps sync file type from placement", () => {
    expect(resolveSyncFileType("front")).toBe("default")
    expect(resolveSyncFileType("default")).toBe("default")
  })

  it("prefers Lifestyle 1–4 style groups for non-apparel", () => {
    const available = ["Flat", "Lifestyle", "Lifestyle 2", "Lifestyle 3", "Lifestyle 4", "On Table"]
    const batches = selectMockupOptionBatches(available)
    expect(batches).toHaveLength(1)
    expect(batches[0].gender).toBe("neutral")
    expect(batches[0].optionGroups).toEqual([
      "Lifestyle",
      "Lifestyle 2",
      "Lifestyle 3",
      "Lifestyle 4",
    ])
  })

  it("uses men's and women's lifestyle for apparel", () => {
    const available = [
      "Flat",
      "Men's Lifestyle",
      "Men's Lifestyle 2",
      "Women's Lifestyle",
      "Women's Lifestyle 3",
    ]
    const batches = selectMockupOptionBatches(available)
    expect(batches.map((b) => b.gender)).toEqual(["male", "female"])
    expect(batches[0].optionGroups[0]).toBe("Men's Lifestyle")
    expect(batches[1].optionGroups[0]).toBe("Women's Lifestyle")
  })

  it("strips FLOOF title prefix", () => {
    expect(stripFloofProductTitle("FLOOF — Humidity Club")).toBe("Humidity Club")
    expect(stripFloofProductTitle("FLOOF - Mug Life")).toBe("Mug Life")
    expect(stripFloofProductTitle("Plain Title")).toBe("Plain Title")
  })

  it("builds centered print position", () => {
    const pos = buildCenteredPrintPosition(1000, 500, 0.5)
    expect(pos.area_width).toBe(1000)
    expect(pos.height).toBe(250)
    expect(pos.top).toBe(125)
  })
})
