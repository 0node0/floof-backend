import { describe, it, expect } from "vitest"
import { isMugWrapImageDimensions } from "../../lib/mug-wrap-asset-detect"

describe("mug-wrap-source-art", () => {
  it("detects full wrap dimensions", () => {
    expect(isMugWrapImageDimensions(2700, 1050)).toBe(true)
    expect(isMugWrapImageDimensions(800, 800)).toBe(false)
  })
})
