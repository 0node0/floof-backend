import { describe, it, expect } from "vitest"
import {
  extractMockupCandidatesFromTask,
  findMatchingBlankCandidate,
  parseGarmentViewFromOptionLabel,
  selectMockupCandidatesForPlacement,
} from "../../lib/apparel-mockup-candidates"

describe("apparel-mockup-candidates", () => {
  it("parses view from option/title only", () => {
    expect(parseGarmentViewFromOptionLabel("Front", "Lifestyle")).toBe("front")
    expect(parseGarmentViewFromOptionLabel("Back", "Black Heather")).toBe("back")
    expect(parseGarmentViewFromOptionLabel("Left", "")).toBe("left")
    expect(parseGarmentViewFromOptionLabel("Men's", "Lifestyle")).toBe("unknown")
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
    const lifestyle = extractMockupCandidatesFromTask(result, "Lifestyle")
    expect(lifestyle.map((c) => c.view)).toEqual(["front", "back"])

    const frontOnly = selectMockupCandidatesForPlacement(
      result,
      "Lifestyle",
      "front",
      "leftChest"
    )
    expect(frontOnly).toHaveLength(1)
    expect(frontOnly[0].url).toBe("https://example.com/front.png")
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
})
