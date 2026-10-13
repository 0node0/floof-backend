import { describe, it, expect } from "vitest"
import {
  resolveMockupPlacement,
  resolveSyncFileType,
  selectMockupOptionBatches,
  stripFloofProductTitle,
  buildCenteredPrintPosition,
  buildDrinkwareFrontFacingPosition,
  resolveDrinkwareLifestyleOptionGroups,
  buildDrinkwareLifestyleGallery,
  isDrinkwarePlacement,
  buildDrinkwarePositionFromTemplateAndPrintfile,
} from "../../lib/printful-mockup-config"

describe("printful-mockup-config", () => {
  it("resolves front for apparel and default for mugs", () => {
    expect(resolveMockupPlacement({ front: "Front", back: "Back" })).toBe("front")
    expect(resolveMockupPlacement({ default: "Print" })).toBe("default")
    expect(isDrinkwarePlacement({ default: "Print" })).toBe(true)
    expect(isDrinkwarePlacement({ front: "Front", back: "Back" })).toBe(false)
  })

  it("maps sync file type from placement", () => {
    expect(resolveSyncFileType("front")).toBe("default")
    expect(resolveSyncFileType("default")).toBe("default")
  })

  it("uses one Printful task per allowed drinkware lifestyle group (skips mirrored Lifestyle 3)", () => {
    const available = [
      "Flat",
      "Lifestyle",
      "Lifestyle 2",
      "Lifestyle 3",
      "Lifestyle 4",
      "On Table",
    ]
    const batches = selectMockupOptionBatches(available, undefined, "drinkware")
    expect(batches).toHaveLength(2)
    expect(batches.map((b) => b.optionGroups[0])).toEqual(["Lifestyle", "Lifestyle 2"])
    expect(batches.every((b) => b.gender === "neutral")).toBe(true)
  })

  it("resolves Lifestyle 1 alias to Lifestyle", () => {
    const groups = resolveDrinkwareLifestyleOptionGroups([
      "Flat",
      "Lifestyle 1",
      "Lifestyle 2",
      "Lifestyle 3",
    ])
    expect(groups).toEqual(["Lifestyle 1", "Lifestyle 2", "Lifestyle 3"])
  })

  it("uses men's and women's lifestyle for apparel", () => {
    const available = [
      "Flat",
      "Men's Lifestyle",
      "Men's Lifestyle 2",
      "Women's Lifestyle",
      "Women's Lifestyle 3",
    ]
    const batches = selectMockupOptionBatches(available, undefined, "apparel")
    expect(batches.map((b) => b.gender)).toEqual(["male", "female"])
    expect(batches[0].optionGroups[0]).toBe("Men's Lifestyle")
    expect(batches[1].optionGroups[0]).toBe("Women's Lifestyle")
  })

  it("strips FLOOF title prefix", () => {
    expect(stripFloofProductTitle("FLOOF — Humidity Club")).toBe("Humidity Club")
    expect(stripFloofProductTitle("FLOOF - Mug Life")).toBe("Mug Life")
    expect(stripFloofProductTitle("Plain Title")).toBe("Plain Title")
  })

  it("builds centered print position for apparel", () => {
    const pos = buildCenteredPrintPosition(1000, 500, 0.5)
    expect(pos.area_width).toBe(1000)
    expect(pos.height).toBe(250)
    expect(pos.top).toBe(125)
  })

  it("centers drinkware art on the wrap (not full width)", () => {
    const pos = buildDrinkwareFrontFacingPosition(2700, 1050)
    expect(pos.area_width).toBe(2700)
    expect(pos.width).toBeLessThan(2700 * 0.5)
    expect(pos.left).toBe(Math.round((2700 - pos.width) / 2))
  })

  it("uses layout template print area when building drinkware position", () => {
    const pos = buildDrinkwarePositionFromTemplateAndPrintfile(
      {
        template_id: 919,
        print_area_width: 520,
        print_area_height: 202,
      },
      { width: 2700, height: 1050 }
    )
    expect(pos.left).toBeGreaterThan(0)
    expect(pos.width).toBeLessThan(pos.area_width)
  })

  it("orders drinkware gallery with lifestyle shots first", () => {
    const gallery = buildDrinkwareLifestyleGallery([
      { url: "https://a/flat.jpg", title: "Flat · Front" },
      { url: "https://a/life2.jpg", title: "Lifestyle 2 · Front" },
      { url: "https://a/life1.jpg", title: "Lifestyle · Front" },
    ])
    expect(gallery[0]).toBe("https://a/life1.jpg")
    expect(gallery[1]).toBe("https://a/life2.jpg")
  })
})
