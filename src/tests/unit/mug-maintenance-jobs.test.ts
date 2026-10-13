import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  getMugMaintenanceJob,
  startMugMaintenanceJob,
} from "../../lib/mug-maintenance-jobs"
import type { MedusaContainer } from "@medusajs/framework/types"

vi.mock("../../lib/maintain-mug-products", () => ({
  maintainMugDesignProducts: vi.fn().mockResolvedValue({
    scanned: 1,
    mugMatched: 1,
    matched: 1,
    titlesUpdated: 0,
    mockupsRegenerated: 0,
    products: [],
    errors: [],
    logs: [],
  }),
}))

describe("mug-maintenance-jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("starts a job and exposes status", async () => {
    const container = {} as MedusaContainer
    const job = startMugMaintenanceJob(container, { regenerateMockups: true })
    expect(job.id).toMatch(/^mug_/)
    expect(["queued", "running"]).toContain(job.status)

    const found = getMugMaintenanceJob(job.id)
    expect(found?.id).toBe(job.id)

    await vi.waitFor(() => {
      const j = getMugMaintenanceJob(job.id)
      expect(j?.status).toBe("completed")
    })
  })
})
