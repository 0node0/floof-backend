import { describe, it, expect, vi } from "vitest"
import {
  extractMockupUrlsForOptionGroup,
  pollPrintfulMockupTask,
  isPrintfulTaskPending,
} from "../../lib/printful-mockup-generator"

describe("printful-mockup-generator", () => {
  it("extracts lifestyle URLs from mockups[].extra by option_group", () => {
    const result = {
      status: "completed",
      mockups: [
        {
          mockup_url: "https://example.com/zoom.png",
          extra: [
            {
              option_group: "Lifestyle",
              option: "Front",
              url: "https://example.com/lifestyle-front.png",
            },
            {
              option_group: "Flat",
              option: "Front",
              url: "https://example.com/flat-front.png",
            },
          ],
        },
      ],
    }
    expect(extractMockupUrlsForOptionGroup(result, "Lifestyle")).toEqual([
      "https://example.com/lifestyle-front.png",
    ])
  })

  it("polls until completed", async () => {
    const client = {
      get: vi
        .fn()
        .mockResolvedValueOnce({ status: "pending" })
        .mockResolvedValueOnce({
          status: "completed",
          mockups: [
            {
              extra: [{ option_group: "Lifestyle 2", url: "https://example.com/l2.png" }],
            },
          ],
        }),
    }
    const out = await pollPrintfulMockupTask(client as any, "gt-123", {
      maxAttempts: 5,
      initialDelayMs: 1,
      maxDelayMs: 2,
      sleep: async () => undefined,
    })
    expect(out.status).toBe("completed")
    expect(isPrintfulTaskPending("pending")).toBe(true)
    expect(client.get).toHaveBeenCalledTimes(2)
  })
})
