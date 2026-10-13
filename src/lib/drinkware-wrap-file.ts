import type PrintfulApiClient from "../modules/printful/client"
import {
  buildMugWrapFullBleedPosition,
  compositeMugWrapPng,
  planMugWrapComposite,
  readMugWrapDimensionsFromPosition,
} from "./mug-wrap-composite"
import { resolveSingleSidedArtPngForWrap } from "./mug-wrap-source-art"
import {
  MugWrapLayoutError,
  validateMugWrapLayout,
  type MugWrapLayoutValidation,
} from "./mug-wrap-layout-guard"
import {
  uploadPngToPrintfulFileLibrary,
  type PrintfulUploadedFile,
} from "./printful-file-upload"
import sharp from "sharp"

export type DrinkwareWrapFile = PrintfulUploadedFile & {
  position: Record<string, number>
}

export type DrinkwareWrapBuildResult = DrinkwareWrapFile & {
  layoutValidation: MugWrapLayoutValidation
  sourceDimensions: { width: number; height: number }
  compositePlan: ReturnType<typeof planMugWrapComposite>
}

export async function fetchDesignPng(designUrl: string): Promise<Buffer> {
  const res = await fetch(designUrl)
  if (!res.ok) {
    throw new Error(`Failed to fetch design (${res.status}): ${designUrl.slice(0, 80)}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

/** Build dual-panel mug wrap PNG and register in Printful file library. */
export async function createDrinkwareWrapPrintfulFile(
  client: PrintfulApiClient,
  designUrl: string,
  position: Record<string, number>,
  log?: (m: string) => void
): Promise<DrinkwareWrapBuildResult> {
  const dims = readMugWrapDimensionsFromPosition(position)
  log?.(
    `Compositing mug wrap ${dims.areaWidth}×${dims.areaHeight} (dual panel, same orientation)…`
  )
  const designPng = await resolveSingleSidedArtPngForWrap(designUrl, dims, log)
  const meta = await sharp(designPng).metadata()
  const sourceDimensions = {
    width: meta.width || 0,
    height: meta.height || 0,
  }
  log?.(`Design source dimensions: ${sourceDimensions.width}×${sourceDimensions.height}`)

  const compositePlan = planMugWrapComposite(
    dims,
    sourceDimensions.width,
    sourceDimensions.height
  )
  log?.(
    `Planned art on wrap: ${compositePlan.artWidth}×${compositePlan.artHeight} (85% half-panel fit)`
  )

  const wrapPng = await compositeMugWrapPng(designPng, dims)
  const layout = await validateMugWrapLayout(wrapPng, dims, compositePlan)
  log?.(`Mug wrap layout guard: ${JSON.stringify(layout)}`)
  if (!layout.ok) {
    throw new MugWrapLayoutError(layout)
  }
  const uploaded = await uploadPngToPrintfulFileLibrary(
    client,
    wrapPng,
    `mug-wrap-${dims.areaWidth}x${dims.areaHeight}.png`,
    log
  )
  return {
    ...uploaded,
    position: buildMugWrapFullBleedPosition(dims.areaWidth, dims.areaHeight),
    layoutValidation: layout,
    sourceDimensions,
    compositePlan,
  }
}
