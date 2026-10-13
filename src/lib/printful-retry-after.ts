/** Parse Printful / HTTP 429 bodies for a server-suggested retry delay (milliseconds). */
export function parsePrintfulRetryAfterMs(message: string): number | undefined {
  const text = message
  const patterns = [
    /retry[- ]after[:\s]+(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?/i,
    /try again after (\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?/i,
    /retry[- ]after[:\s]+(\d+)\b/i,
    /too many requests[^.]*?(\d+)\s*s(?:ec(?:ond)?s?)?/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m) {
      const seconds = Number(m[1])
      if (!Number.isNaN(seconds) && seconds >= 0) {
        return Math.round(seconds * 1000)
      }
    }
  }
  return undefined
}
