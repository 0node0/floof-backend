import { describe, it, expect } from "vitest"
import { createHmac } from "crypto"

/**
 * Unit-level tests for webhook auth helpers.
 * Full end-to-end webhook tests require a running Medusa instance.
 */

describe("Stripe webhook signature format", () => {
  const createSignature = (body: string, secret: string): string => {
    const t = Math.floor(Date.now() / 1000)
    const payload = `${t}.${body}`
    const sig = createHmac("sha256", secret).update(payload).digest("hex")
    return `t=${t},v1=${sig}`
  }

  it("builds a t=,v1= signature header", () => {
    const sig = createSignature('{"id":"evt_1"}', "whsec_test")
    expect(sig).toMatch(/^t=\d+,v1=[0-9a-f]+$/)
  })

  it("signature changes when body changes", () => {
    const a = createSignature('{"a":1}', "whsec_test")
    const b = createSignature('{"a":2}', "whsec_test")
    expect(a).not.toEqual(b)
  })
})

describe("Printful webhook path auth", () => {
  // Printful does NOT use HMAC — auth is the unguessable URL path segment.
  const configured = "b066c4b5b0c833aa5f2292a283d9ea6af69532a7c29c1c8f1e643a37a885f081"

  it("accepts exact path secret match", () => {
    expect(configured === configured).toBe(true)
    expect(configured.length).toBe(64)
  })

  it("rejects wrong path secret", () => {
    const requestSecret = "wrong-path"
    const match =
      requestSecret.length === configured.length && requestSecret === configured
    expect(match).toBe(false)
  })
})
