import sharp from "sharp"
import type PrintfulApiClient from "../modules/printful/client"
import {
  extractMockupCandidatesFromTask,
  findMatchingBlankCandidate,
  pickPreferredMockupCandidate,
  selectMockupCandidatesForPlacement,
  type MockupImageCandidate,
} from "./apparel-mockup-candidates"
import {
  capMockupOptionGroupsForProduct,
  filterMockupOptionGroupsForPlacement,
} from "./apparel-mockup-options"
import {
  fetchImageBuffer,
  validateMockupArtVisibility,
} from "./apparel-mockup-validation"
import {
  buildApparelFullBleedPosition,
  type ApparelPlacementLayout,
  type ApparelPrintPosition,
} from "./apparel-placement-layout"
import { generateTemplateFallbackMockup } from "./apparel-mockup-template-fallback"
import { uploadPngToPrintfulFileLibrary } from "./printful-file-upload"
import { resolveFullPrintfulFileUrlById } from "./printful-file-url"
import { sleep as delay } from "./async-sleep"
import { dedupeMockupShotsByScene } from "./mockup-scene-dedupe"
import { loadPrintfulMockupConfig } from "./printful-mockup-config"
import { runPrintfulMockupTask, type MockupTaskRunLog } from "./printful-mockup-generator"
import {
  buildApparelMockupFilePayload,
  mockupCreateOptionsForPlacement,
} from "./printful-mockup-request"
import { withPrintfulRetries } from "./printful-retry"

export type ApparelMockupShot = {
  url: string
  kind?: string
  gender?: "male" | "female" | "neutral"
  title?: string
  placement: string
  templateFallback?: boolean
  view?: string
  option?: string
}

export type ApparelMockupPrintInput = {
  placement: string
  designSourceUrl: string
  printPosition: ApparelPrintPosition
  printAreaUrl?: string
  artworkWidth?: number
  artworkHeight?: number
}

export class ApparelMockupValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ApparelMockupValidationError"
  }
}

const blankTaskCache = new Map<string, MockupTaskRunLog>()

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
  return full?.url || uploaded.cdnUrl
}

async function runBlankGarmentMockupTask(opts: {
  client: PrintfulApiClient
  catalogProductId: number
  variantIds: number[]
  placement: string
  group: string
  areaW: number
  areaH: number
  log: (m: string) => void
}): Promise<MockupTaskRunLog> {
  const cacheKey = `${opts.catalogProductId}:${opts.placement}:${opts.group}:${opts.areaW}x${opts.areaH}`
  const cached = blankTaskCache.get(cacheKey)
  if (cached) return cached

  const blankFileUrl = await ensureBlankPrintFileUrl(
    opts.client,
    opts.areaW,
    opts.areaH,
    opts.log
  )
  const position = buildApparelFullBleedPosition(opts.areaW, opts.areaH)
  const options = mockupCreateOptionsForPlacement(opts.placement)
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
          ...(options ? { options } : {}),
        },
        {
          log: opts.log,
          optionGroupLabel: opts.group,
          sleep: (ms) => delay(ms).then(() => undefined),
        }
      )
  )
  blankTaskCache.set(cacheKey, taskLog)
  return taskLog
}

async function validateMockupAgainstMatchedBlank(
  designUrl: string,
  blankUrl: string,
  design: MockupImageCandidate,
  blank: MockupImageCandidate,
  printPosition: ApparelPrintPosition,
  log: (m: string) => void
): Promise<{
  pixelDiffRatio: number
  inBoxPixelDiffRatio: number
  passThreshold: number
  passed: boolean
}> {
  log(
    `Mockup validation view=${design.view} option="${design.option}" ` +
      `blankOption="${blank.option}" design=${designUrl.slice(0, 64)}…`
  )
  const [designBuf, blankBuf] = await Promise.all([
    fetchImageBuffer(designUrl),
    fetchImageBuffer(blankUrl),
  ])
  const result = await validateMockupArtVisibility(designBuf, blankBuf, printPosition)
  log(
    `Mockup validation: full ${(result.fullFrameRatio * 100).toFixed(2)}% differ, ` +
      `in-box ${(result.inBoxRatio * 100).toFixed(2)}% differ (region ${result.region.width}×${result.region.height})`
  )
  return {
    pixelDiffRatio: result.fullFrameRatio,
    inBoxPixelDiffRatio: result.inBoxRatio,
    passThreshold: result.passThreshold,
    passed: result.passed,
  }
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
  const placement = opts.filePayload.placement
  const options = mockupCreateOptionsForPlacement(placement)
  if (placement === "back") {
    opts.log(
      `Back mockup task placement=back option_groups=${opts.group} options=${JSON.stringify(options)} ` +
        `position=${JSON.stringify(opts.filePayload.position)}`
    )
  }

  const taskLog = await runPrintfulMockupTask(
    opts.client,
    opts.catalogProductId,
    {
      variant_ids: opts.variantIds.slice(0, 2),
      format: "jpg",
      files: [opts.filePayload],
      option_groups: [opts.group],
      ...(options ? { options } : {}),
    },
    {
      log: opts.log,
      optionGroupLabel: opts.group,
      sleep: (ms) => delay(ms).then(() => undefined),
    }
  )

  return { shots: [], taskLog }
}

function shotFromCandidate(
  candidate: MockupImageCandidate,
  opts: {
    group: string
    placement: string
    gender: "male" | "female" | "neutral"
    templateFallback?: boolean
  }
): ApparelMockupShot {
  return {
    url: candidate.url,
    kind: /lifestyle/i.test(opts.group) ? "lifestyle" : "other",
    gender: opts.gender,
    title: `${opts.group} · ${opts.placement}${opts.templateFallback ? " (template)" : ""}`,
    placement: opts.placement,
    templateFallback: opts.templateFallback,
    view: candidate.view,
    option: candidate.option,
  }
}

function buildLifestyleGalleryFromShots(shots: ApparelMockupShot[]): string[] {
  const prefer = (s: ApparelMockupShot) => {
    if (s.templateFallback) return 2
    if (s.placement === "front") return 0
    if (s.placement === "back") return 1
    return 3
  }
  const sorted = [...shots].sort((a, b) => prefer(a) - prefer(b))
  const urls: string[] = []
  for (const s of sorted) {
    if (s.url && !urls.includes(s.url)) urls.push(s.url)
  }
  return urls.slice(0, 7)
}

async function tryTemplateFallback(opts: {
  client: PrintfulApiClient
  catalogProductId: number
  variantId: number
  placement: string
  printAreaUrl: string
  printPosition: ApparelPrintPosition
  group: string
  gender: "male" | "female" | "neutral"
  log: (m: string) => void
}): Promise<ApparelMockupShot> {
  const printAreaBuf = await fetchImageBuffer(opts.printAreaUrl)
  const fallbackUrl = await generateTemplateFallbackMockup({
    client: opts.client,
    catalogProductId: opts.catalogProductId,
    variantId: opts.variantId,
    placement: opts.placement,
    printAreaPng: printAreaBuf,
    printPosition: opts.printPosition,
    log: opts.log,
  })
  return {
    url: fallbackUrl,
    kind: /lifestyle/i.test(opts.group) ? "lifestyle" : "other",
    gender: opts.gender,
    title: `${opts.group} · ${opts.placement} (template)`,
    placement: opts.placement,
    templateFallback: true,
    view: opts.placement === "back" ? "back" : "front",
  }
}

export async function generateApparelPlacementMockups(opts: {
  client: PrintfulApiClient
  catalogProductId: number
  variantIds: number[]
  layout: ApparelPlacementLayout
  printFiles: ApparelMockupPrintInput[]
  log: (m: string) => void
}): Promise<{
  shots: ApparelMockupShot[]
  gallery: string[]
  validatedGallery: string[]
  hasValidatedMockups: boolean
  mockupTasks: MockupTaskRunLog[]
}> {
  const { client, catalogProductId, variantIds, layout, log } = opts
  const vids = variantIds.slice(0, 2)
  const taskRetries = Number(process.env.PRINTFUL_MOCKUP_TASK_RETRIES || 6)
  const taskGapMs = Number(process.env.PRINTFUL_MOCKUP_TASK_DELAY_MS || 3000)
  let shots: ApparelMockupShot[] = []
  const validatedShots: ApparelMockupShot[] = []
  const mockupTasks: MockupTaskRunLog[] = []
  let hasPassingFront = false
  let hasPassingBack = false

  const mockupConfig = await loadPrintfulMockupConfig(client, catalogProductId, variantIds)

  for (const printFile of opts.printFiles) {
    const placement = printFile.placement
    const filePayload = buildApparelMockupFilePayload({
      placement,
      designSourceUrl: printFile.designSourceUrl,
      printPosition: printFile.printPosition,
      artworkWidth: printFile.artworkWidth,
      artworkHeight: printFile.artworkHeight,
    })
    const areaW = Number(filePayload.position.area_width)
    const areaH = Number(filePayload.position.area_height)

    log(
      `Apparel mockups placement=${placement} layout=${layout} artwork=${filePayload.image_url.slice(0, 72)}… ` +
        `position=${JSON.stringify(filePayload.position)}`
    )

    for (const batch of mockupConfig.batches) {
      const groups = capMockupOptionGroupsForProduct(
        placement,
        filterMockupOptionGroupsForPlacement(
          placement,
          batch.optionGroups.filter(Boolean)
        )
      )
      if (groups.length) {
        log(`Mockup option groups placement=${placement}: ${groups.join(", ")}`)
      }
      for (const group of groups) {
        try {
          const blankTask = await runBlankGarmentMockupTask({
            client,
            catalogProductId,
            variantIds: vids,
            placement,
            group,
            areaW,
            areaH,
            log,
          })
          const blankPoll = blankTask.pollResponse
          if (!blankPoll) {
            throw new ApparelMockupValidationError("Blank mockup task missing poll response")
          }
          const blankCandidates = extractMockupCandidatesFromTask(blankPoll, group, placement)

          const { taskLog } = await withPrintfulRetries(
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

          const poll = taskLog.pollResponse
          if (!poll) {
            throw new ApparelMockupValidationError("Mockup task missing poll response")
          }

          const allowed = selectMockupCandidatesForPlacement(poll, group, placement, layout)
          const designCandidate = pickPreferredMockupCandidate(allowed)
          let finalShot: ApparelMockupShot | undefined
          let usedFallback = false

          const applyFallback = async (reason: string) => {
            log(`${reason} — template fallback for ${placement}/${group}`)
            if (!printFile.printAreaUrl) {
              throw new ApparelMockupValidationError(
                `No printAreaUrl for template fallback (${placement}/${group})`
              )
            }
            finalShot = await tryTemplateFallback({
              client,
              catalogProductId,
              variantId: vids[0],
              placement,
              printAreaUrl: printFile.printAreaUrl,
              printPosition: printFile.printPosition,
              group,
              gender: batch.gender,
              log,
            })
            usedFallback = true
            taskLog.usedTemplateFallback = true
          }

          if (!designCandidate) {
            log(
              `No ${placement} view candidate for group=${group} (layout=${layout}); ` +
                `candidates=${extractMockupCandidatesFromTask(poll, group, placement).length}`
            )
            taskLog.validation = { unknown: true, passed: false }
            if (placement === "back" || printFile.printAreaUrl) {
              await applyFallback("No view-matched mockup candidate")
            } else {
              mockupTasks.push(taskLog)
              continue
            }
          } else {
            const blankMatch = findMatchingBlankCandidate(blankCandidates, designCandidate)

            if (!blankMatch) {
              log(
                `No matching blank for view=${designCandidate.view} option="${designCandidate.option}" — validation unknown`
              )
              taskLog.validation = {
                unknown: true,
                passed: false,
                designOption: designCandidate.option,
                designView: designCandidate.view,
              }
              await applyFallback("Could not match blank garment view/option")
            } else {
              const validation = await validateMockupAgainstMatchedBlank(
                designCandidate.url,
                blankMatch.url,
                designCandidate,
                blankMatch,
                printFile.printPosition,
                log
              )
              taskLog.validation = {
                pixelDiffRatio: validation.pixelDiffRatio,
                inBoxPixelDiffRatio: validation.inBoxPixelDiffRatio,
                inBoxPassThreshold: validation.passThreshold,
                passed: validation.passed,
                comparedToBlankUrl: blankMatch.url,
                designOption: designCandidate.option,
                designView: designCandidate.view,
                blankOption: blankMatch.option,
              }

              if (!validation.passed) {
                await applyFallback("Mockup failed pixel validation")
              } else {
                finalShot = shotFromCandidate(designCandidate, {
                  group,
                  placement,
                  gender: batch.gender,
                })
              }
            }
          }

          if (!finalShot) {
            mockupTasks.push(taskLog)
            continue
          }

          if (taskLog.validation?.passed) {
            if (placement === "front") hasPassingFront = true
            if (placement === "back") hasPassingBack = true
            validatedShots.push(finalShot)
          } else if (usedFallback && placement === "back") {
            hasPassingBack = true
          }

          shots.push(finalShot)
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

  if (layout === "chestPlusBack") {
    if (!hasPassingFront) {
      throw new ApparelMockupValidationError(
        "chestPlusBack requires at least one passing Front mockup with visible art"
      )
    }
    if (!hasPassingBack) {
      throw new ApparelMockupValidationError(
        "chestPlusBack requires at least one passing Back mockup (or template fallback)"
      )
    }
  }

  if (!shots.length) {
    throw new ApparelMockupValidationError("No mockup images were generated")
  }

  if (layout !== "chestPlusBack") {
    shots = shots.filter(
      (s) =>
        s.placement === "front" &&
        s.view !== "back" &&
        s.view !== "left" &&
        s.view !== "right"
    )
  }

  shots = dedupeMockupShotsByScene(shots)
  const validatedDeduped = dedupeMockupShotsByScene(validatedShots)
  const gallery = buildLifestyleGalleryFromShots(shots)
  const validatedGallery = buildLifestyleGalleryFromShots(validatedDeduped)
  const hasValidatedMockups = validatedGallery.length > 0
  log(
    `Apparel placement gallery (${gallery.length} images, ${validatedGallery.length} validated)`
  )
  return {
    shots,
    gallery,
    validatedGallery,
    hasValidatedMockups,
    mockupTasks,
  }
}
