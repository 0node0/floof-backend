import { describe, it, expect } from "vitest"
import { getMaintenanceJob } from "../../lib/maintenance-jobs"
import { startMugMaintenanceJob } from "../../lib/mug-maintenance-jobs"
import { startApparelMaintenanceJob } from "../../lib/apparel-maintenance-jobs"
import type { MedusaContainer } from "@medusajs/framework/types"
import { vi } from "vitest"

vi.mock("../../lib/maintain-mug-products", () => ({
  maintainMugDesignProducts: vi.fn().mockResolvedValue({
    scanned: 0,
    mugMatched: 0,
    matched: 0,
    titlesUpdated: 0,
    mockupsRegenerated: 0,
    products: [],
    errors: [],
    logs: [],
  }),
}))

vi.mock("../../lib/maintain-apparel-placements", () => ({
  maintainApparelPlacements: vi.fn().mockResolvedValue({
    scanned: 0,
    processed: 0,
    products: [],
    errors: [],
    logs: [],
  }),
}))

describe("maintenance-jobs", () => {
  it("resolves mug and apparel jobs by id prefix", async () => {
    const container = {} as MedusaContainer
    const mug = startMugMaintenanceJob(container, {})
    const apparel = startApparelMaintenanceJob(container, {
      products: [{ productId: "p1", layout: "centred" }],
    })
    expect(getMaintenanceJob(mug.id)?.kind).toBe("mug")
    expect(getMaintenanceJob(apparel.id)?.kind).toBe("apparel")
    expect(getMaintenanceJob("missing")).toBeNull()
    await vi.waitFor(() => {
      expect(getMaintenanceJob(mug.id)?.status).toBe("completed")
      expect(getMaintenanceJob(apparel.id)?.status).toBe("completed")
    })
  })
})
