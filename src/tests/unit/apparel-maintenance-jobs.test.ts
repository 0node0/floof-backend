import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  getApparelMaintenanceJob,
  startApparelMaintenanceJob,
} from "../../lib/apparel-maintenance-jobs"
import type { MedusaContainer } from "@medusajs/framework/types"

vi.mock("../../lib/maintain-apparel-placements", () => ({
  maintainApparelPlacements: vi.fn().mockResolvedValue({
    scanned: 1,
    processed: 1,
    products: [],
    errors: [],
    logs: [],
  }),
}))

describe("apparel-maintenance-jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("starts a job and completes asynchronously", async () => {
    const container = {} as MedusaContainer
    const job = startApparelMaintenanceJob(container, {
      products: [{ productId: "prod_1", layout: "leftChest" }],
    })
    expect(job.id).toMatch(/^apparel_/)
    expect(["queued", "running"]).toContain(job.status)

    await vi.waitFor(() => {
      const j = getApparelMaintenanceJob(job.id)
      expect(j?.status).toBe("completed")
    })
  })
})
