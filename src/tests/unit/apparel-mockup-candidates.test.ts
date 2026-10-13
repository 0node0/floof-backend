import { describe, it, expect } from "vitest"
import {
  extractMockupCandidatesFromTask,
  findMatchingBlankCandidate,
  inferMainMockupEntryView,
  parseGarmentViewFromOptionLabel,
  pickPreferredMockupCandidate,
  selectMockupCandidatesForPlacement,
} from "../../lib/apparel-mockup-candidates"

describe("apparel-mockup-candidates", () => {
  it("parses view from option/title only", () => {
    expect(parseGarmentViewFromOptionLabel("Front", "Lifestyle")).toBe("front")
    expect(parseGarmentViewFromOptionLabel("Back", "Black Heather")).toBe("back")
    expect(parseGarmentViewFromOptionLabel("Left", "")).toBe("left")
    expect(parseGarmentViewFromOptionLabel("Men's", "Lifestyle")).toBe("unknown")
  })

  it("treats main mockup_url as front when placement is front and no option label", () => {
    const entry = {
      placement: "front",
      mockup_url:
        "https://files.printful.com/unisex-staple-t-shirt-black-front-dtg.png",
    }
    expect(inferMainMockupEntryView(entry, "front")).toBe("front")

    const result = {
      mockups: [
        {
          placement: "front",
          mockup_url:
            "https://files.printful.com/unisex-staple-t-shirt-black-front-dtg.png",
        },
      ],
    }
    const candidates = extractMockupCandidatesFromTask(
      result,
      "Women's Lifestyle 3",
      "front"
    )
    expect(candidates).toHaveLength(1)
    expect(candidates[0].view).toBe("front")
    expect(candidates[0].isMainMockupUrl).toBe(true)

    const allowed = selectMockupCandidatesForPlacement(
      result,
      "Women's Lifestyle 3",
      "front",
      "leftChest"
    )
    expect(allowed).toHaveLength(1)
    expect(pickPreferredMockupCandidate(allowed)?.url).toContain("front-dtg")
  })

  it("extracts candidates per option_group and ignores other groups", () => {
    const result = {
      mockups: [
        {
          mockup_url: "https://example.com/main.png",
          extra: [
            {
              option_group: "Lifestyle",
              option: "Front",
              url: "https://example.com/front.png",
            },
            {
              option_group: "Lifestyle",
              option: "Back",
              url: "https://example.com/back.png",
            },
          ],
        },
      ],
    }
    const lifestyle = extractMockupCandidatesFromTask(result, "Lifestyle", "front")
    expect(lifestyle.some((c) => c.view === "front")).toBe(true)
    expect(lifestyle.some((c) => c.view === "back")).toBe(true)

    const frontOnly = selectMockupCandidatesForPlacement(
      result,
      "Lifestyle",
      "front",
      "leftChest"
    )
    expect(frontOnly.every((c) => c.view === "front")).toBe(true)
  })

  it("matches blank garment by view, option and option_group", () => {
    const design = {
      url: "https://example.com/d.png",
      optionGroup: "Lifestyle",
      option: "Black / M",
      view: "front" as const,
    }
    const blanks = [
      {
        url: "https://example.com/b-back.png",
        optionGroup: "Lifestyle",
        option: "Black / M",
        view: "back" as const,
      },
      {
        url: "https://example.com/b-front.png",
        optionGroup: "Lifestyle",
        option: "Black / M",
        view: "front" as const,
      },
    ]
    expect(findMatchingBlankCandidate(blanks, design)?.url).toBe(
      "https://example.com/b-front.png"
    )
  })

  it("matches main mockup Default option to blank Default option", () => {
    const design = {
      url: "https://example.com/d.png",
      optionGroup: "Women's Lifestyle 3",
      option: "Default",
      view: "front" as const,
      isMainMockupUrl: true,
    }
    const blanks = [
      {
        url: "https://example.com/blank.png",
        optionGroup: "Women's Lifestyle 3",
        option: "Default",
        view: "front" as const,
        isMainMockupUrl: true,
      },
    ]
    expect(findMatchingBlankCandidate(blanks, design)?.url).toBe(
      "https://example.com/blank.png"
    )
  })
})
