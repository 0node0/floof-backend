import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  floofBackendPublicOrigin,
  isEphemeralFloofHostedImageUrl,
  isFloofStaticDiskImageUrl,
} from "../../lib/ephemeral-floof-image-url"

describe("ephemeral-floof-image-url", () => {
  const prev = process.env.MEDUSA_BACKEND_URL

  beforeEach(() => {
    process.env.MEDUSA_BACKEND_URL = "https://api.floof.space"
  })

  afterEach(() => {
    process.env.MEDUSA_BACKEND_URL = prev
  })

  it("detects Railway static disk URLs on the public API host", () => {
    expect(
      isFloofStaticDiskImageUrl(
        "https://api.floof.space/static/1792268509962-flower-crown-labrador-sticker-art.png"
      )
    ).toBe(true)
    expect(floofBackendPublicOrigin()).toBe("https://api.floof.space")
  })

  it("treats design-files and static as ephemeral", () => {
    expect(isEphemeralFloofHostedImageUrl("https://api.floof.space/floof/design-files/abc")).toBe(
      true
    )
    expect(
      isEphemeralFloofHostedImageUrl(
        "https://files.cdn.printful.com/files/abc/preview.png"
      )
    ).toBe(false)
  })
})
