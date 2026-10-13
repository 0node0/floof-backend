import sharp from "sharp"
import type PrintfulApiClient from "../modules/printful/client"
import { trimTransparentPng, scaleToFitBox } from "./apparel-art-prep"
import { fetchAndAssertSingleSidedDesignPng } from "./mug-design-source"
import { uploadPngToPrintfulFileLibrary } from "./printful-file-upload"
import { resolveFullPrintfulFileUrlById } from "./printful-file-url"
import {
  buildApparelFullBleedPosition,
  clampPrintPosition,
  type ApparelPrintPlacementSpec,
  type ApparelPrintPosition,
} from "./apparel-placement-layout"

export type ApparelCompositedPrintFile = {
  placement: string
  syncFileType: string
  position: ApparelPrintPosition
  /** Full-area composited PNG for mockups (same bytes as sync print file). */
  mockupPosition: ApparelPrintPosition
  fileId?: number
  cdnUrl?: string
  mockupUrl?: string
}

export async function compositeDesignIntoPrintArea(
  designPng: Buffer,
  position: ApparelPrintPosition
): Promise<{ png: Buffer; renderedWidth: number; renderedHeight: number }> {
  const box = clampPrintPosition(position)
  const areaW = box.area_width
  const areaH = box.area_height
  const boxW = box.width
  const boxH = box.height

  const trimmed = await trimTransparentPng(designPng)
  const meta = await sharp(trimmed).metadata()
  const srcW = Math.max(1, meta.width || 1)
  const srcH = Math.max(1, meta.height || 1)
  const { width: w, height: h } = scaleToFitBox(srcW, srcH, boxW, boxH)
  const resized = await sharp(trimmed).resize(w, h, { fit: "fill" }).png().toBuffer()

  let left = box.left + Math.round((boxW - w) / 2)
  let top = box.top + Math.round((boxH - h) / 2)
  left = Math.max(0, Math.min(left, areaW - w))
  top = Math.max(0, Math.min(top, areaH - h))

  const png = await sharp({
    create: {
      width: areaW,
      height: areaH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: resized, left, top }])
    .png()
    .toBuffer()

  return { png, renderedWidth: w, renderedHeight: h }
}

export async function buildApparelPrintFilesForPlacements(
  client: PrintfulApiClient,
  designUrl: string,
  placements: ApparelPrintPlacementSpec[],
  log?: (m: string) => void,
  opts?: { dryRun?: boolean }
): Promise<ApparelCompositedPrintFile[]> {
  const designPng = opts?.dryRun
    ? null
    : await fetchAndAssertSingleSidedDesignPng(designUrl, log)
  const results: ApparelCompositedPrintFile[] = []

  for (const spec of placements) {
    const position = clampPrintPosition(spec.position)
    const mockupPosition = buildApparelFullBleedPosition(position.area_width, position.area_height)

    if (opts?.dryRun) {
      results.push({
        placement: spec.placement,
        syncFileType: spec.syncFileType,
        position,
        mockupPosition,
      })
      continue
    }

    const { png: compositePng } = await compositeDesignIntoPrintArea(designPng!, position)
    const uploaded = await uploadPngToPrintfulFileLibrary(
      client,
      compositePng,
      `apparel-${spec.placement}-${position.area_width}x${position.area_height}.png`,
      log
    )
    const full = await resolveFullPrintfulFileUrlById(client, uploaded.fileId, log)
    const mockupUrl = full?.url || uploaded.cdnUrl
    results.push({
      placement: spec.placement,
      syncFileType: spec.syncFileType,
      position,
      mockupPosition,
      fileId: uploaded.fileId,
      cdnUrl: uploaded.cdnUrl,
      mockupUrl,
    })
    log?.(
      `Apparel print file ${spec.placement}: fileId=${uploaded.fileId} box=${JSON.stringify(position)} mockupUrl=${mockupUrl.slice(0, 72)}`
    )
  }

  return results
}
