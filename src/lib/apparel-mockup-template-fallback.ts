import sharp from "sharp"
import type PrintfulApiClient from "../modules/printful/client"
import {
  clampPrintPosition,
  type ApparelPrintPosition,
} from "./apparel-placement-layout"
import {
  findLayoutTemplateForVariant,
  type LayoutTemplate,
  type MockupTemplatesResult,
} from "./printful-mockup-config"
import { uploadBinaryToPrintfulFileLibrary } from "./printful-file-upload"
import { fetchImageBuffer } from "./apparel-mockup-validation"

export async function loadMockupTemplates(
  client: PrintfulApiClient,
  catalogProductId: number
): Promise<MockupTemplatesResult> {
  return client.get<MockupTemplatesResult>(`/mockup-generator/templates/${catalogProductId}`)
}

/** Map printfile coordinates (e.g. 1800×2400) onto template print_area using scale = print_area_width / area_width. */
export function computeTemplateArtRect(
  template: LayoutTemplate,
  printPosition: ApparelPrintPosition
): { left: number; top: number; width: number; height: number } {
  const box = clampPrintPosition(printPosition)
  const printAreaW = template.print_area_width || template.template_width || 560
  const scale = printAreaW / box.area_width
  const width = Math.round(box.width * scale)
  const height = Math.round(box.height * scale)
  const left = Math.round((template.print_area_left || 0) + box.left * scale)
  const top = Math.round((template.print_area_top || 0) + box.top * scale)
  return { left, top, width, height }
}

export async function compositeArtOntoLayoutTemplate(
  template: LayoutTemplate,
  printAreaPng: Buffer,
  printPosition: ApparelPrintPosition
): Promise<Buffer> {
  const templateW = template.template_width || 560
  const templateH = template.template_height || 295
  const box = clampPrintPosition(printPosition)
  const rect = computeTemplateArtRect(template, box)

  const templateBuf = await fetchImageBuffer(String(template.image_url))
  const art = await sharp(printAreaPng)
    .extract({
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
    })
    .resize(rect.width, rect.height, { fit: "fill" })
    .png()
    .toBuffer()

  return sharp(templateBuf)
    .resize(templateW, templateH, { fit: "fill" })
    .composite([{ input: art, left: rect.left, top: rect.top }])
    .jpeg({ quality: 92 })
    .toBuffer()
}

/** @deprecated use compositeArtOntoLayoutTemplate */
export async function compositePrintAreaOntoLayoutTemplate(
  template: LayoutTemplate,
  printAreaPng: Buffer,
  printPosition?: ApparelPrintPosition
): Promise<Buffer> {
  if (printPosition) {
    return compositeArtOntoLayoutTemplate(template, printAreaPng, printPosition)
  }
  const fallbackPos: ApparelPrintPosition = {
    area_width: 1800,
    area_height: 2400,
    width: 1800,
    height: 2400,
    left: 0,
    top: 0,
  }
  return compositeArtOntoLayoutTemplate(template, printAreaPng, fallbackPos)
}

export async function generateTemplateFallbackMockup(opts: {
  client: PrintfulApiClient
  catalogProductId: number
  variantId: number
  placement: string
  printAreaPng: Buffer
  printPosition: ApparelPrintPosition
  log: (m: string) => void
}): Promise<string> {
  const templates = await loadMockupTemplates(opts.client, opts.catalogProductId)
  const layout = findLayoutTemplateForVariant(templates, opts.variantId, opts.placement)
  if (!layout?.image_url) {
    throw new Error(`No layout template for placement=${opts.placement} variant=${opts.variantId}`)
  }
  const jpeg = await compositeArtOntoLayoutTemplate(
    layout,
    opts.printAreaPng,
    opts.printPosition
  )
  const uploaded = await uploadBinaryToPrintfulFileLibrary(
    opts.client,
    jpeg,
    `apparel-template-mockup-${opts.placement}-${opts.variantId}.jpg`,
    "image/jpeg",
    opts.log
  )
  return uploaded.cdnUrl
}
