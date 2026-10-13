import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  throttlePrintfulMockupCreateTask,
  resetPrintfulMockupCreateTaskThrottle,
} from "../../lib/printful-mockup-rate-limit"

describe("printful-mockup-rate-limit", () => {
  beforeEach(() => {
    resetPrintfulMockupCreateTaskThrottle()
    vi.useFakeTimers()
    process.env.PRINTFUL_MOCKUP_CREATE_MIN_MS = "100"
  })

  afterEach(() => {
    vi.useRealTimers()
    delete process.env.PRINTFUL_MOCKUP_CREATE_MIN_MS
  })

  it("waits between consecutive create-task calls", async () => {
    const p1 = throttlePrintfulMockupCreateTask()
    await vi.runAllTimersAsync()
    await p1

    vi.advanceTimersByTime(50)
    const p2 = throttlePrintfulMockupCreateTask()
    await vi.runAllTimersAsync()
    await p2

    expect(vi.getTimerCount()).toBe(0)
  })
})
