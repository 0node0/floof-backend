import sharp from "sharp"
import type PrintfulApiClient from "../modules/printful/client"
import { fetchAndAssertSingleSidedDesignPng } from "./mug-design-source"
import { uploadPngToPrintfulFileLibrary } from "./printful-file-upload"
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
  mockupPosition: ApparelPrintPosition
  fileId?: number
  cdnUrl?: string
}

export async function compositeDesignIntoPrintArea(
  designPng: Buffer,
  position: ApparelPrintPosition
): Promise<Buffer> {
  const box = clampPrintPosition(position)
  const areaW = box.area_width
  const areaH = box.area_height
  const boxW = box.width
  const boxH = box.height
  const meta = await sharp(designPng).metadata()
  const srcW = Math.max(1, meta.width || 1)
  const srcH = Math.max(1, meta.height || 1)
  const scale = Math.min(boxW / srcW, boxH / srcH, 1)
  const w = Math.max(1, Math.min(Math.round(srcW * scale), areaW))
  const h = Math.max(1, Math.min(Math.round(srcH * scale), areaH))
  const resized = await sharp(designPng)
    .resize(w, h, { fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer()
  let left = box.left + Math.round((boxW - w) / 2)
  let top = box.top + Math.round((boxH - h) / 2)
  left = Math.max(0, Math.min(left, areaW - w))
  top = Math.max(0, Math.min(top, areaH - h))

  return sharp({
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

    const compositePng = await compositeDesignIntoPrintArea(designPng!, position)
    const uploaded = await uploadPngToPrintfulFileLibrary(
      client,
      compositePng,
      `apparel-${spec.placement}-${position.area_width}x${position.area_height}.png`,
      log
    )
    results.push({
      placement: spec.placement,
      syncFileType: spec.syncFileType,
      position,
      mockupPosition,
      fileId: uploaded.fileId,
      cdnUrl: uploaded.cdnUrl,
    })
    log?.(
      `Apparel print file ${spec.placement}: fileId=${uploaded.fileId} box=${JSON.stringify(position)}`
    )
  }

  return results
}
