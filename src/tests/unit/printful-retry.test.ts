import { describe, it, expect, vi } from "vitest"
import { withPrintfulRetries } from "../../lib/printful-retry"

describe("printful-retry", () => {
  it("retries on 429 then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Printful GET /x -> 429: slow down"))
      .mockResolvedValueOnce("ok")
    const result = await withPrintfulRetries("test", () => undefined, fn, 3, 10)
    expect(result).toBe("ok")
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
