import type PrintfulApiClient from "../modules/printful/client"
import {
  buildMugWrapFullBleedPosition,
  compositeMugWrapPng,
  readMugWrapDimensionsFromPosition,
} from "./mug-wrap-composite"
import {
  uploadPngToPrintfulFileLibrary,
  type PrintfulUploadedFile,
} from "./printful-file-upload"

export type DrinkwareWrapFile = PrintfulUploadedFile & {
  position: Record<string, number>
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
): Promise<DrinkwareWrapFile> {
  const dims = readMugWrapDimensionsFromPosition(position)
  log?.(
    `Compositing mug wrap ${dims.areaWidth}×${dims.areaHeight} (dual panel, mirrored back)…`
  )
  const designPng = await fetchDesignPng(designUrl)
  const wrapPng = await compositeMugWrapPng(designPng, dims)
  const uploaded = await uploadPngToPrintfulFileLibrary(
    client,
    wrapPng,
    `mug-wrap-${dims.areaWidth}x${dims.areaHeight}.png`,
    log
  )
  return {
    ...uploaded,
    position: buildMugWrapFullBleedPosition(dims.areaWidth, dims.areaHeight),
  }
}
