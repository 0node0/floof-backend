import type { MockupTaskRunLog } from "./printful-mockup-generator"
import { isPrintfulTaskFailed } from "./printful-mockup-generator"
import { sceneKeyFromMockupTitle } from "./mockup-scene-dedupe"

type SceneShot = { url: string; title?: string }

export type MugMockupSceneResult = {
  optionGroup: string
  sceneKey: string
  success: boolean
  mockupUrl?: string
  error?: string
  attempts: number
  taskKey?: string
  taskStatus?: string
}

/** Handheld close-up (Lifestyle 2) sorts before woman-holding (Lifestyle). */
export function drinkwareGallerySortScore(title?: string): number {
  const t = title || ""
  if (/lifestyle\s*2\b/i.test(t)) return 0
  const m = /^lifestyle\s*(\d+)?/i.exec(t.trim())
  if (m) return m[1] ? parseInt(m[1], 10) : 1
  if (/lifestyle/i.test(t)) return 1
  if (/flat/i.test(t)) return 100
  return 50
}

export function sceneFailureReason(
  taskLog: MockupTaskRunLog | undefined,
  shots: SceneShot[]
): string | null {
  if (!taskLog) return "no task log returned"
  const st = String(taskLog.status || "").toLowerCase()
  if (isPrintfulTaskFailed(st)) {
    return taskLog.error || `Printful task status=${taskLog.status}`
  }
  if (!taskLog.mockupUrls.length && !shots.length) {
    return taskLog.error || "task completed with 0 mockup URLs"
  }
  if (!shots.length) return "no mockup shot extracted for scene"
  return null
}

export function buildSceneResult(
  optionGroup: string,
  attempts: number,
  taskLog: MockupTaskRunLog | undefined,
  shots: SceneShot[]
): MugMockupSceneResult {
  const title = shots[0]?.title || `${optionGroup} · mockup`
  const sceneKey = sceneKeyFromMockupTitle(title)
  const failure = sceneFailureReason(taskLog, shots)
  return {
    optionGroup,
    sceneKey,
    success: !failure && shots.length > 0,
    mockupUrl: shots[0]?.url,
    error: failure || undefined,
    attempts,
    taskKey: taskLog?.taskKey,
    taskStatus: taskLog?.status,
  }
}

export function countSuccessfulScenes(scenes: MugMockupSceneResult[]): number {
  const keys = new Set<string>()
  for (const s of scenes) {
    if (s.success && s.sceneKey) keys.add(s.sceneKey)
  }
  return keys.size
}
