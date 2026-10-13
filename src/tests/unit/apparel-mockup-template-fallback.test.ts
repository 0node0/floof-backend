import { describe, it, expect, vi, beforeEach } from "vitest"
import sharp from "sharp"
import { compositePrintAreaOntoLayoutTemplate } from "../../lib/apparel-mockup-template-fallback"
import type { LayoutTemplate } from "../../lib/printful-mockup-config"

vi.mock("../../lib/apparel-mockup-validation", () => ({
  fetchImageBuffer: vi.fn(async (url: string) => {
    if (url.includes("template")) {
      return sharp({
        create: { width: 100, height: 50, channels: 3, background: { r: 200, g: 200, b: 200 } },
      })
        .jpeg()
        .toBuffer()
    }
    throw new Error(`unexpected url ${url}`)
  }),
}))

describe("apparel-mockup-template-fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("composites print area into template coordinates", async () => {
    const template: LayoutTemplate = {
      template_id: 1,
      template_width: 100,
      template_height: 50,
      print_area_width: 40,
      print_area_height: 30,
      print_area_left: 30,
      print_area_top: 10,
      image_url: "https://example.com/template.jpg",
    }
    const printPng = await sharp({
      create: { width: 10, height: 10, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    })
      .png()
      .toBuffer()

    const jpeg = await compositePrintAreaOntoLayoutTemplate(template, printPng)
    const meta = await sharp(jpeg).metadata()
    expect(meta.width).toBe(100)
    expect(meta.height).toBe(50)
    expect(meta.format).toBe("jpeg")
  })
})
