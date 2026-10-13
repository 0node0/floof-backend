import { describe, it, expect } from "vitest"
import { syncVariantFilesMatch } from "../../lib/printful-apparel-sync"

describe("printful-apparel-sync", () => {
  it("detects when sync variant files already match", () => {
    const existing = [{ id: 10, type: "default" }, { id: 20, type: "back" }]
    expect(
      syncVariantFilesMatch(existing, [
        { fileId: 10, type: "default" },
        { fileId: 20, type: "back" },
      ])
    ).toBe(true)
    expect(syncVariantFilesMatch(existing, [{ fileId: 11, type: "default" }])).toBe(false)
  })
})
