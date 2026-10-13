import { sleep } from "./async-sleep"
import { parsePrintfulRetryAfterMs } from "./printful-retry-after"

function isRateLimitError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /Printful .* -> 429\b|rate limit|too many requests/i.test(msg)
}

export function computePrintfulRetryWaitMs(
  message: string,
  attemptIndex: number,
  baseMs: number
): number {
  const fromHeader = parsePrintfulRetryAfterMs(message)
  const exponential = baseMs * Math.pow(2, attemptIndex)
  return Math.max(exponential, fromHeader ?? 0)
}

/** Retry Printful API calls with exponential backoff on HTTP 429. */
export async function withPrintfulRetries<T>(
  label: string,
  log: (m: string) => void,
  fn: () => Promise<T>,
  attempts = Number(process.env.PRINTFUL_API_RETRIES || 6),
  baseMs = Number(process.env.PRINTFUL_API_RETRY_MS || 3000)
): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e: unknown) {
      lastError = e
      const msg = e instanceof Error ? e.message : String(e)
      if (i >= attempts - 1 || !isRateLimitError(e)) break
      const wait = computePrintfulRetryWaitMs(msg, i, baseMs)
      log(`${label}: rate limited (${msg.slice(0, 120)}) — retry in ${wait}ms`)
      await sleep(wait)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
