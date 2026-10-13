import sharp from "sharp"
import type PrintfulApiClient from "../modules/printful/client"
import { fetchAndAssertSingleSidedDesignPng } from "./mug-design-source"
import { uploadPngToPrintfulFileLibrary } from "./printful-file-upload"
import {
  buildApparelFullBleedPosition,
  type ApparelPrintPlacementSpec,
} from "./apparel-placement-layout"

export type ApparelCompositedPrintFile = {
  placement: string
  syncFileType: string
  position: Record<string, number>
  mockupPosition: Record<string, number>
  fileId: number
  cdnUrl: string
}

async function compositeDesignIntoPrintArea(
  designPng: Buffer,
  position: Record<string, number>
): Promise<Buffer> {
  const areaW = position.area_width
  const areaH = position.area_height
  const boxW = position.width
  const boxH = position.height
  const meta = await sharp(designPng).metadata()
  const srcW = Math.max(1, meta.width || 1)
  const srcH = Math.max(1, meta.height || 1)
  const scale = Math.min(boxW / srcW, boxH / srcH)
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))
  const resized = await sharp(designPng).resize(w, h, { fit: "inside" }).png().toBuffer()
  const left = position.left + Math.round((boxW - w) / 2)
  const top = position.top + Math.round((boxH - h) / 2)

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
  log?: (m: string) => void
): Promise<ApparelCompositedPrintFile[]> {
  const designPng = await fetchAndAssertSingleSidedDesignPng(designUrl, log)
  const results: ApparelCompositedPrintFile[] = []

  for (const spec of placements) {
    const compositePng = await compositeDesignIntoPrintArea(designPng, spec.position)
    const uploaded = await uploadPngToPrintfulFileLibrary(
      client,
      compositePng,
      `apparel-${spec.placement}-${spec.position.area_width}x${spec.position.area_height}.png`,
      log
    )
    const mockupPosition = buildApparelFullBleedPosition(
      spec.position.area_width,
      spec.position.area_height
    )
    results.push({
      placement: spec.placement,
      syncFileType: spec.syncFileType,
      position: spec.position,
      mockupPosition,
      fileId: uploaded.fileId,
      cdnUrl: uploaded.cdnUrl,
    })
    log?.(
      `Apparel print file ${spec.placement}: fileId=${uploaded.fileId} artBox=${JSON.stringify(spec.position)}`
    )
  }

  return results
}
