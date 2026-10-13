import { describe, it, expect } from "vitest"
import { parsePrintfulRetryAfterMs } from "../../lib/printful-retry-after"
import { computePrintfulRetryWaitMs } from "../../lib/printful-retry"

describe("printful-retry-after", () => {
  it("parses retry-after seconds from Printful error text", () => {
    expect(
      parsePrintfulRetryAfterMs("Printful POST -> 429: Too many requests. Retry after 12 seconds")
    ).toBe(12000)
    expect(parsePrintfulRetryAfterMs("Please try again after 5 seconds")).toBe(5000)
  })

  it("uses max of exponential backoff and retry-after hint", () => {
    const wait = computePrintfulRetryWaitMs("Retry after 10 seconds", 0, 3000)
    expect(wait).toBe(10000)
    const wait2 = computePrintfulRetryWaitMs("rate limited", 2, 3000)
    expect(wait2).toBe(12000)
  })
})
