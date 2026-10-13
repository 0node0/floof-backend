import { describe, it, expect } from "vitest"
import { formatErrorMessage } from "../../lib/serialize-error"

describe("formatErrorMessage", () => {
  it("serializes object error messages", () => {
    const err = { message: { code: "invalid", field: "images" } } as unknown as Error
    expect(formatErrorMessage(err)).toContain("invalid")
  })

  it("JSON-stringifies plain objects", () => {
    expect(formatErrorMessage({ errors: [{ msg: "bad" }] })).toContain("bad")
  })
})
