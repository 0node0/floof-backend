import sharp from "sharp"
import type PrintfulApiClient from "../modules/printful/client"
import { filterMockupOptionGroupsForPlacement } from "./apparel-mockup-options"
import {
  fetchImageBuffer,
  mockupPixelDifference,
  mockupShowsDesign,
} from "./apparel-mockup-validation"
import { buildApparelFullBleedPosition, type ApparelPrintPosition } from "./apparel-placement-layout"
import { generateTemplateFallbackMockup } from "./apparel-mockup-template-fallback"
import { uploadPngToPrintfulFileLibrary } from "./printful-file-upload"
import { resolveFullPrintfulFileUrlById } from "./printful-file-url"
import { sleep as delay } from "./async-sleep"
import { dedupeMockupShotsByScene } from "./mockup-scene-dedupe"
import { loadPrintfulMockupConfig } from "./printful-mockup-config"
import { runPrintfulMockupTask, type MockupTaskRunLog } from "./printful-mockup-generator"
import { buildApparelMockupFilePayload } from "./printful-mockup-request"
import { withPrintfulRetries } from "./printful-retry"

export type ApparelMockupShot = {
  url: string
  kind?: string
  gender?: "male" | "female" | "neutral"
  title?: string
  placement: string
  templateFallback?: boolean
}

export type ApparelMockupPrintInput = {
  placement: string
  /** Original artwork URL (not the composited print-area PNG). */
  designSourceUrl: string
  /** Placement box inside the printfile (area_width × area_height). */
  printPosition: ApparelPrintPosition
  /** Full print-area PNG already on Printful — used for template compositing fallback. */
  printAreaUrl?: string
}

export class ApparelMockupValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ApparelMockupValidationError"
  }
}

const blankFileUrlCache = new Map<string, string>()
const blankMockupUrlCache = new Map<string, string>()

async function transparentPrintAreaPng(areaW: number, areaH: number): Promise<Buffer> {
  return sharp({
    create: {
      width: areaW,
      height: areaH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer()
}

async function ensureBlankPrintFileUrl(
  client: PrintfulApiClient,
  areaW: number,
  areaH: number,
  log: (m: string) => void
): Promise<string> {
  const key = `${areaW}x${areaH}`
  const cached = blankFileUrlCache.get(key)
  if (cached) return cached
  const png = await transparentPrintAreaPng(areaW, areaH)
  const uploaded = await withPrintfulRetries(
    "Upload blank print-area PNG",
    log,
    () =>
      uploadPngToPrintfulFileLibrary(
        client,
        png,
        `apparel-blank-${areaW}x${areaH}.png`,
        log
      )
  )
  const full = await resolveFullPrintfulFileUrlById(client, uploaded.fileId, log)
  const url = full?.url || uploaded.cdnUrl
  blankFileUrlCache.set(key, url)
  return url
}

async function ensureBlankGarmentMockupUrl(opts: {
  client: PrintfulApiClient
  catalogProductId: number
  variantIds: number[]
  placement: string
  group: string
  areaW: number
  areaH: number
  log: (m: string) => void
}): Promise<string> {
  const cacheKey = `${opts.catalogProductId}:${opts.placement}:${opts.group}:${opts.areaW}x${opts.areaH}`
  const cached = blankMockupUrlCache.get(cacheKey)
  if (cached) return cached

  const blankFileUrl = await ensureBlankPrintFileUrl(
    opts.client,
    opts.areaW,
    opts.areaH,
    opts.log
  )
  const position = buildApparelFullBleedPosition(opts.areaW, opts.areaH)
  const taskLog = await withPrintfulRetries(
    `Blank garment mockup ${opts.placement} (${opts.group})`,
    opts.log,
    () =>
      runPrintfulMockupTask(
        opts.client,
        opts.catalogProductId,
        {
          variant_ids: opts.variantIds.slice(0, 2),
          format: "jpg",
          files: [{ placement: opts.placement, image_url: blankFileUrl, position }],
          option_groups: [opts.group],
        },
        {
          log: opts.log,
          optionGroupLabel: opts.group,
          sleep: (ms) => delay(ms).then(() => undefined),
        }
      )
  )
  const blankUrl = taskLog.mockupUrls[0]
  if (!blankUrl) {
    throw new ApparelMockupValidationError(
      `Blank garment mockup returned no URL (${opts.placement} / ${opts.group})`
    )
  }
  blankMockupUrlCache.set(cacheKey, blankUrl)
  return blankUrl
}

async function validateMockupAgainstBlank(
  designUrl: string,
  blankUrl: string,
  log: (m: string) => void
): Promise<{ pixelDiffRatio: number; passed: boolean }> {
  const [designBuf, blankBuf] = await Promise.all([
    fetchImageBuffer(designUrl),
    fetchImageBuffer(blankUrl),
  ])
  const diff = await mockupPixelDifference(designBuf, blankBuf)
  log(
    `Mockup validation: ${(diff.ratio * 100).toFixed(2)}% pixels differ from blank garment`
  )
  const passed = mockupShowsDesign(diff)
  return { pixelDiffRatio: diff.ratio, passed }
}

async function runPlacementMockupTask(opts: {
  client: PrintfulApiClient
  catalogProductId: number
  variantIds: number[]
  filePayload: ReturnType<typeof buildApparelMockupFilePayload>
  group: string
  gender: "male" | "female" | "neutral"
  log: (m: string) => void
}): Promise<{ shots: ApparelMockupShot[]; taskLog: MockupTaskRunLog }> {
  const taskLog = await runPrintfulMockupTask(
    opts.client,
    opts.catalogProductId,
    {
      variant_ids: opts.variantIds.slice(0, 2),
      format: "jpg",
      files: [opts.filePayload],
      option_groups: [opts.group],
    },
    {
      log: opts.log,
      optionGroupLabel: opts.group,
      sleep: (ms) => delay(ms).then(() => undefined),
    }
  )

  const shots: ApparelMockupShot[] = []
  for (const url of taskLog.mockupUrls) {
    shots.push({
      url,
      kind: /lifestyle/i.test(opts.group) ? "lifestyle" : "other",
      gender: opts.gender,
      title: `${opts.group} · ${opts.filePayload.placement}`,
      placement: opts.filePayload.placement,
    })
  }
  return { shots, taskLog }
}

function buildLifestyleGalleryFromShots(shots: ApparelMockupShot[]): string[] {
  const frontFirst = [...shots].sort((a, b) => {
    if (a.placement === b.placement) return 0
    if (a.placement === "front") return -1
    if (b.placement === "front") return 1
    return 0
  })
  const urls: string[] = []
  for (const s of frontFirst) {
    if (s.url && !urls.includes(s.url)) urls.push(s.url)
  }
  return urls.slice(0, 7)
}

export async function generateApparelPlacementMockups(opts: {
  client: PrintfulApiClient
  catalogProductId: number
  variantIds: number[]
  printFiles: ApparelMockupPrintInput[]
  log: (m: string) => void
}): Promise<{
  shots: ApparelMockupShot[]
  gallery: string[]
  mockupTasks: MockupTaskRunLog[]
}> {
  const { client, catalogProductId, variantIds, log } = opts
  const vids = variantIds.slice(0, 2)
  const taskRetries = Number(process.env.PRINTFUL_MOCKUP_TASK_RETRIES || 3)
  const taskGapMs = Number(process.env.PRINTFUL_MOCKUP_TASK_DELAY_MS || 2500)
  let shots: ApparelMockupShot[] = []
  const mockupTasks: MockupTaskRunLog[] = []

  const mockupConfig = await loadPrintfulMockupConfig(client, catalogProductId, variantIds)

  for (const printFile of opts.printFiles) {
    const placement = printFile.placement
    const filePayload = buildApparelMockupFilePayload({
      placement,
      designSourceUrl: printFile.designSourceUrl,
      printPosition: printFile.printPosition,
    })
    const areaW = Number(filePayload.position.area_width)
    const areaH = Number(filePayload.position.area_height)

    log(
      `Apparel mockups placement=${placement} artwork=${filePayload.image_url.slice(0, 72)}… ` +
        `position=${JSON.stringify(filePayload.position)}`
    )

    for (const batch of mockupConfig.batches) {
      const groups = filterMockupOptionGroupsForPlacement(
        placement,
        batch.optionGroups.filter(Boolean)
      )
      for (const group of groups) {
        try {
          const blankUrl = await ensureBlankGarmentMockupUrl({
            client,
            catalogProductId,
            variantIds: vids,
            placement,
            group,
            areaW,
            areaH,
            log,
          })

          const { shots: batchShots, taskLog } = await withPrintfulRetries(
            `Mockup ${placement} (${group})`,
            log,
            () =>
              runPlacementMockupTask({
                client,
                catalogProductId,
                variantIds: vids,
                filePayload,
                group,
                gender: batch.gender,
                log,
              }),
            taskRetries,
            taskGapMs
          )

          let finalShots = batchShots
          if (batchShots.length) {
            const validation = await validateMockupAgainstBlank(
              batchShots[0].url,
              blankUrl,
              log
            )
            taskLog.validation = {
              pixelDiffRatio: validation.pixelDiffRatio,
              passed: validation.passed,
              comparedToBlankUrl: blankUrl,
            }

            if (!validation.passed) {
              log(
                `Mockup blank for ${placement}/${group} — trying template fallback`
              )
              if (!printFile.printAreaUrl) {
                throw new ApparelMockupValidationError(
                  `Mockup appears blank and no printAreaUrl for template fallback`
                )
              }
              const printAreaBuf = await fetchImageBuffer(printFile.printAreaUrl)
              const fallbackUrl = await generateTemplateFallbackMockup({
                client,
                catalogProductId,
                variantId: vids[0],
                placement,
                printAreaPng: printAreaBuf,
                log,
              })
              taskLog.usedTemplateFallback = true
              finalShots = [
                {
                  url: fallbackUrl,
                  kind: /lifestyle/i.test(group) ? "lifestyle" : "other",
                  gender: batch.gender,
                  title: `${group} · ${placement} (template)`,
                  placement,
                  templateFallback: true,
                },
              ]
            }
          }

          shots = shots.concat(finalShots)
          mockupTasks.push(taskLog)
        } catch (e: unknown) {
          if (e instanceof ApparelMockupValidationError) throw e
          log(
            `Mockup task failed placement=${placement} group=${group}: ${
              e instanceof Error ? e.message : String(e)
            }`
          )
        }
      }
    }
  }

  if (!shots.length) {
    throw new ApparelMockupValidationError("No mockup images were generated")
  }

  shots = dedupeMockupShotsByScene(shots)
  const gallery = buildLifestyleGalleryFromShots(shots)
  log(`Apparel placement gallery (${gallery.length} images)`)
  return { shots, gallery, mockupTasks }
}
