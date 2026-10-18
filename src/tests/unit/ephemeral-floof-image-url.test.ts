import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  floofBackendPublicOrigin,
  isDurableProductImageUrl,
  isEphemeralFloofHostedImageUrl,
  isEphemeralPrintfulMockupTaskUrl,
  isEphemeralProductGalleryImageUrl,
  isFloofStaticDiskImageUrl,
  isPrintfulFileLibraryCdnUrl,
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

  it("detects ephemeral Printful mockup-task URLs", () => {
    expect(
      isEphemeralPrintfulMockupTaskUrl(
        "https://printful-upload.s3-accelerate.amazonaws.com/tmp/mockup-abc.png"
      )
    ).toBe(true)
    expect(
      isEphemeralPrintfulMockupTaskUrl(
        "https://files.cdn.printful.com/mockup-generator/abc/preview.png"
      )
    ).toBe(true)
    expect(isPrintfulFileLibraryCdnUrl("https://files.cdn.printful.com/files/abc/preview.png")).toBe(
      true
    )
    expect(
      isEphemeralPrintfulMockupTaskUrl("https://files.cdn.printful.com/files/abc/preview.png")
    ).toBe(false)
    expect(
      isEphemeralProductGalleryImageUrl(
        "https://printful-upload.s3.amazonaws.com/tmp/foo.jpg"
      )
    ).toBe(true)
  })

  it("treats file-library CDN as durable", () => {
    const durable = "https://files.cdn.printful.com/files/abc/preview.png"
    expect(isDurableProductImageUrl(durable)).toBe(true)
    expect(isEphemeralProductGalleryImageUrl(durable)).toBe(false)
  })
})
