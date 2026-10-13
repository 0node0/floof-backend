import { describe, it, expect } from "vitest"
import { pickFullResolutionPrintfulFileUrl } from "../../lib/printful-file-url"

describe("printful-file-url", () => {
  it("prefers full url over preview_url", () => {
    const url = pickFullResolutionPrintfulFileUrl({
      url: "https://files.cdn.printful.com/files/aa/full.png",
      preview_url: "https://files.cdn.printful.com/files/aa/preview_800.png",
    })
    expect(url).toBe("https://files.cdn.printful.com/files/aa/full.png")
  })
})
