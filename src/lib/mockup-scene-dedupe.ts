export type MockupShotLike = {
  url: string
  title?: string
  kind?: string
}

/** Stable key for one lifestyle scene (Lifestyle, Lifestyle 2, …). */
export function sceneKeyFromMockupTitle(title?: string): string {
  const t = title || ""
  const m = /lifestyle\s*(\d+)?/i.exec(t)
  if (m) return `lifestyle-${m[1] || "1"}`
  if (/men's lifestyle\s*(\d+)?/i.test(t)) {
    const g = /men's lifestyle\s*(\d+)?/i.exec(t)
    return `mens-lifestyle-${g?.[1] || "1"}`
  }
  if (/women's lifestyle\s*(\d+)?/i.test(t)) {
    const g = /women's lifestyle\s*(\d+)?/i.exec(t)
    return `womens-lifestyle-${g?.[1] || "1"}`
  }
  return t.trim().toLowerCase() || "unknown"
}

/** One mockup image per scene (keeps first occurrence). */
export function dedupeMockupShotsByScene<T extends MockupShotLike>(shots: T[]): T[] {
  const seenScene = new Set<string>()
  const seenUrl = new Set<string>()
  const out: T[] = []
  for (const s of shots) {
    const scene = sceneKeyFromMockupTitle(s.title)
    if (seenScene.has(scene)) continue
    if (seenUrl.has(s.url)) continue
    seenScene.add(scene)
    seenUrl.add(s.url)
    out.push(s)
  }
  return out
}
