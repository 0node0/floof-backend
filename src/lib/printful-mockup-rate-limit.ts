import { sleep } from "./async-sleep"

let lastMockupCreateTaskMs = 0

/** @internal test helper */
export function resetPrintfulMockupCreateTaskThrottle(): void {
  lastMockupCreateTaskMs = 0
}

/** Printful mockup-generator create-task rate limit (default 3s between tasks). */
export async function throttlePrintfulMockupCreateTask(): Promise<void> {
  const minGap = Number(process.env.PRINTFUL_MOCKUP_CREATE_MIN_MS || 3000)
  const now = Date.now()
  const wait = lastMockupCreateTaskMs + minGap - now
  if (wait > 0) {
    await sleep(wait)
  }
  lastMockupCreateTaskMs = Date.now()
}
