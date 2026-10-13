import { describe, it, expect } from "vitest"
import { buildSyncVariantFileReports } from "../../lib/printful-mug-sync"

describe("printful-mug-sync", () => {
  it("reports when variant file matches composite id", () => {
    const reports = buildSyncVariantFileReports(
      [
        { id: 101, variant_id: 4011, files: [{ id: 55, type: "default" }] },
        { id: 102, variant_id: 4012, files: [{ id: 99, type: "default" }] },
      ],
      55,
      "default"
    )
    expect(reports[0].compositeFileMatches).toBe(true)
    expect(reports[1].compositeFileMatches).toBe(false)
    expect(reports[0].printfulFileId).toBe(55)
  })
})
