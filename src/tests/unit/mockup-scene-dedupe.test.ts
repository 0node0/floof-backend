import { describe, it, expect } from "vitest"
import {
  dedupeMockupShotsByScene,
  sceneKeyFromMockupTitle,
} from "../../lib/mockup-scene-dedupe"

describe("mockup-scene-dedupe", () => {
  it("maps lifestyle titles to scene keys", () => {
    expect(sceneKeyFromMockupTitle("Lifestyle · mockup")).toBe("lifestyle-1")
    expect(sceneKeyFromMockupTitle("Lifestyle 2 · mockup")).toBe("lifestyle-2")
  })

  it("keeps one shot per scene", () => {
    const out = dedupeMockupShotsByScene([
      { url: "https://a/1.jpg", title: "Lifestyle · mockup" },
      { url: "https://a/2.jpg", title: "Lifestyle · mockup" },
      { url: "https://a/3.jpg", title: "Lifestyle 2 · mockup" },
    ])
    expect(out).toHaveLength(2)
    expect(out.map((s) => s.url)).toEqual(["https://a/1.jpg", "https://a/3.jpg"])
  })
})
