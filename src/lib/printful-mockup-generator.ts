/**
 * Printful mockup-generator API (v1): create-task + task?task_key polling.
 * @see https://developers.printful.com/docs/#tag/Mockup-Generator-API
 */

import type PrintfulApiClient from "../modules/printful/client"
import { extractMockupCandidatesFromTask } from "./apparel-mockup-candidates"
import { throttlePrintfulMockupCreateTask } from "./printful-mockup-rate-limit"
import { parsePrintfulRetryAfterMs } from "./printful-retry-after"
import { sleep } from "./async-sleep"

export type MockupPrintPosition = Record<string, number | boolean>

export type MockupCreateTaskRequest = {
  variant_ids: number[]
  format: "jpg" | "png"
  files: Array<{
    placement: string
    image_url: string
    position: MockupPrintPosition
  }>
  option_groups?: string[]
  options?: string[]
}

export type PrintfulMockupExtra = {
  title?: string
  url?: string
  mockup_url?: string
  option?: string
  option_group?: string
}

export type PrintfulMockupEntry = {
  placement?: string
  display_name?: string
  mockup_url?: string
  url?: string
  variant_ids?: number[]
  extra?: PrintfulMockupExtra[]
}

export type PrintfulMockupTaskResult = {
  task_key?: string
  status?: string
  task_status?: string
  error?: string
  mockups?: PrintfulMockupEntry[]
}

export type MockupTaskRunLog = {
  taskKey: string
  request: MockupCreateTaskRequest
  createResponse?: PrintfulMockupTaskResult
  pollResponse?: PrintfulMockupTaskResult
  status: string
  error?: string
  mockupUrls: string[]
  pollAttempts: number
  validation?: {
    pixelDiffRatio?: number
    passed?: boolean
    unknown?: boolean
    comparedToBlankUrl?: string
    designOption?: string
    designView?: string
    blankOption?: string
  }
  usedTemplateFallback?: boolean
}

export type PollMockupTaskOptions = {
  maxAttempts?: number
  initialDelayMs?: number
  maxDelayMs?: number
  log?: (message: string) => void
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_POLL: PollMockupTaskOptions = {
  maxAttempts: 60,
  initialDelayMs: 2500,
  maxDelayMs: 12000,
}

function taskStatus(result: PrintfulMockupTaskResult): string {
  return String(result.status || result.task_status || "").toLowerCase()
}

function normalizeUrl(u?: string): string | null {
  if (!u || typeof u !== "string") return null
  const t = u.trim()
  return t.length ? t : null
}

/**
 * Extract mockup URLs for a requested option_group from a completed task.
 * Prefer structured selection via `extractMockupCandidatesFromTask` for apparel.
 */
export function extractMockupUrlsForOptionGroup(
  result: PrintfulMockupTaskResult,
  optionGroup: string
): string[] {
  return extractMockupCandidatesFromTask(result, optionGroup).map((c) => c.url)
}

export function isPrintfulTaskPending(status: string): boolean {
  return status === "pending" || status === "processing" || status === "inprogress"
}

export function isPrintfulTaskComplete(status: string): boolean {
  return status === "completed"
}

export function isPrintfulTaskFailed(status: string): boolean {
  return status === "failed" || status === "error"
}

export async function pollPrintfulMockupTask(
  client: PrintfulApiClient,
  taskKey: string,
  opts: PollMockupTaskOptions = {}
): Promise<{ result: PrintfulMockupTaskResult; attempts: number; status: string }> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_POLL.maxAttempts!
  const sleepFn = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  let delay = opts.initialDelayMs ?? DEFAULT_POLL.initialDelayMs!
  const maxDelay = opts.maxDelayMs ?? DEFAULT_POLL.maxDelayMs!
  const log = opts.log ?? (() => undefined)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await sleepFn(delay)
    let statusBody: PrintfulMockupTaskResult
    try {
      statusBody = await client.get<PrintfulMockupTaskResult>(
        `/mockup-generator/task?task_key=${encodeURIComponent(taskKey)}`
      )
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/429|rate limit|too many requests/i.test(msg)) {
        const retryAfter = parsePrintfulRetryAfterMs(msg)
        const wait = Math.max(delay, retryAfter ?? 0)
        log(`Mockup poll ${attempt}: rate limited — backing off ${wait}ms`)
        await sleepFn(wait)
        delay = Math.min(Math.max(delay * 2, wait), maxDelay)
        continue
      }
      throw e
    }

    const st = taskStatus(statusBody)
    log(`Mockup poll ${attempt}: status=${st}`)

    if (isPrintfulTaskPending(st)) {
      delay = Math.min(Math.round(delay * 1.15), maxDelay)
      continue
    }

    if (isPrintfulTaskComplete(st)) {
      return { result: statusBody, attempts: attempt, status: st }
    }

    if (isPrintfulTaskFailed(st)) {
      return { result: statusBody, attempts: attempt, status: st }
    }

    return { result: statusBody, attempts: attempt, status: st || "unknown" }
  }

  throw new Error(`Printful mockup task ${taskKey} timed out after ${maxAttempts} polls`)
}

export async function runPrintfulMockupTask(
  client: PrintfulApiClient,
  catalogProductId: number,
  request: MockupCreateTaskRequest,
  opts: PollMockupTaskOptions & { optionGroupLabel?: string } = {}
): Promise<MockupTaskRunLog> {
  const log = opts.log ?? (() => undefined)
  const optionGroup = request.option_groups?.[0] || opts.optionGroupLabel || ""

  log(
    `Printful mockup POST /mockup-generator/create-task/${catalogProductId} ` +
      `option_groups=${JSON.stringify(request.option_groups)} ` +
      `placement=${request.files[0]?.placement} ` +
      `position=${JSON.stringify(request.files[0]?.position)} ` +
      `variants=${JSON.stringify(request.variant_ids)}`
  )

  await throttlePrintfulMockupCreateTask()

  const created = await client.post<PrintfulMockupTaskResult>(
    `/mockup-generator/create-task/${catalogProductId}`,
    request
  )
  const taskKey = created.task_key || (created as { taskKey?: string }).taskKey
  if (!taskKey) {
    throw new Error(
      `Printful mockup create-task missing task_key: ${JSON.stringify(created).slice(0, 300)}`
    )
  }
  log(`Printful mockup task_key=${taskKey}`)

  const polled = await pollPrintfulMockupTask(client, taskKey, opts)
  const st = polled.status
  const mockupUrls = isPrintfulTaskComplete(st)
    ? extractMockupUrlsForOptionGroup(polled.result, optionGroup)
    : []

  if (mockupUrls.length) {
    log(`Printful mockup URLs (${optionGroup}): ${mockupUrls.join(", ")}`)
  } else if (isPrintfulTaskComplete(st)) {
    log(`Printful mockup completed with 0 URLs for option_group=${optionGroup}`)
  } else {
    log(`Printful mockup ended status=${st} error=${polled.result.error || "n/a"}`)
  }

  return {
    taskKey,
    request,
    createResponse: created,
    pollResponse: polled.result,
    status: st,
    error: polled.result.error,
    mockupUrls,
    pollAttempts: polled.attempts,
  }
}
