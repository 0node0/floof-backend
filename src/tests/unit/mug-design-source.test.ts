import { describe, it, expect } from "vitest"
import {
  readDesignSourceFromMetadata,
  resolveSourceUrlFromMap,
} from "../../lib/mug-design-source"

describe("mug-design-source", () => {
  it("reads design source metadata fields", () => {
    const m = readDesignSourceFromMetadata({
      designSourceFileId: 12345,
      designSourceUrl: "https://files.cdn.printful.com/files/abc/preview.png",
    })
    expect(m.fileId).toBe(12345)
    expect(m.url).toContain("printful.com")
  })

  it("resolves sourceUrls by product id or handle", () => {
    const url = "https://files.cdn.printful.com/files/original.png"
    const map = { prod_abc: url, "pro-snuggler": url }
    expect(
      resolveSourceUrlFromMap(map, { id: "prod_abc", handle: "other" })
    ).toBe(url)
    expect(
      resolveSourceUrlFromMap(map, { id: "x", handle: "pro-snuggler" })
    ).toBe(url)
  })
})
