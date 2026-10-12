import { describe, it, expect, vi } from "vitest"
import {
  isEphemeralFloofDesignUrl,
  isPrintfulFileLibraryUrl,
  pickDurableUrlFromFile,
  resolveDurablePrintfulDesignUrl,
} from "../../lib/printful-design-url"
import type PrintfulApiClient from "../../modules/printful/client"

describe("printful-design-url", () => {
  it("flags floof staging URLs as ephemeral", () => {
    expect(
      isEphemeralFloofDesignUrl("https://api.floof.space/floof/design-files/abc123")
    ).toBe(true)
    expect(isEphemeralFloofDesignUrl("https://files.cdn.printful.com/files/x.png")).toBe(
      false
    )
  })

  it("prefers Printful CDN over floof staging on sync files", () => {
    const u = pickDurableUrlFromFile({
      url: "https://api.floof.space/floof/design-files/old",
      preview_url: "https://files.cdn.printful.com/files/abc/preview.png",
    })
    expect(u).toBe("https://files.cdn.printful.com/files/abc/preview.png")
    expect(isPrintfulFileLibraryUrl(u!)).toBe(true)
  })

  it("polls /files/{id} when only ephemeral url is on variant", async () => {
    const get = vi.fn().mockResolvedValue({
      status: "ok",
      preview_url: "https://files.cdn.printful.com/files/new/preview.png",
      url: "https://api.floof.space/floof/design-files/dead",
    })
    const client = { get } as unknown as PrintfulApiClient

    const url = await resolveDurablePrintfulDesignUrl(
      client,
      [{ files: [{ id: 99, type: "default", url: "https://api.floof.space/floof/design-files/dead" }] }],
      { log: () => undefined }
    )

    expect(url).toBe("https://files.cdn.printful.com/files/new/preview.png")
    expect(get).toHaveBeenCalledWith("/files/99")
  })
})
