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

/**
 * Map print-file pixels onto the template print area (12″ width ↔ print_area_width px).
 * Art size: (artIn / printFileIn) × print_area_width — e.g. 3.75″ → 3.75/12 × print_area_width.
 */
export function computeTemplateArtRect(
  template: LayoutTemplate,
  printPosition: ApparelPrintPosition
): { left: number; top: number; width: number; height: number } {
  const box = clampPrintPosition(printPosition)
  const printFileW = box.area_width
  const printFileH = box.area_height
  const printSpanW = template.print_area_width || template.template_width || 560
  const printSpanH = template.print_area_height || template.template_height || 295
  const printL = template.print_area_left ?? 0
  const printT = template.print_area_top ?? 0

  const width = Math.round((box.width / printFileW) * printSpanW)
  const height = Math.round((box.height / printFileH) * printSpanH)
  let left = Math.round(printL + (box.left / printFileW) * printSpanW)
  let top = Math.round(printT + (box.top / printFileH) * printSpanH)

  const maxRight = printL + printSpanW
  const maxBottom = printT + printSpanH
  if (left + width > maxRight) {
    left = Math.max(printL, maxRight - width)
  }
  if (top + height > maxBottom) {
    top = Math.max(printT, maxBottom - height)
  }
  left = Math.max(printL, left)
  top = Math.max(printT, top)

  return { left, top, width, height }
}

/** Art width in template px for a given width in inches on a 12″ print area. */
export function templateArtWidthInchesToPx(
  template: LayoutTemplate,
  artWidthInches: number,
  printFileWidthInches = 12
): number {
  const printSpanW = template.print_area_width || 560
  return Math.round((artWidthInches / printFileWidthInches) * printSpanW)
}

export function clampExtractRegion(
  imageWidth: number,
  imageHeight: number,
  region: { left: number; top: number; width: number; height: number }
): { left: number; top: number; width: number; height: number } {
  const iw = Math.max(1, Math.floor(imageWidth))
  const ih = Math.max(1, Math.floor(imageHeight))
  const left = Math.max(0, Math.min(Math.floor(region.left), iw - 1))
  const top = Math.max(0, Math.min(Math.floor(region.top), ih - 1))
  const maxW = iw - left
  const maxH = ih - top
  const width = Math.max(1, Math.min(Math.floor(region.width), maxW))
  const height = Math.max(1, Math.min(Math.floor(region.height), maxH))
  return { left, top, width, height }
}

/** Scale print-area box to actual PNG pixels when file size ≠ declared area_width/height. */
export function resolvePrintAreaExtractBox(
  imageWidth: number,
  imageHeight: number,
  printPosition: ApparelPrintPosition
): { left: number; top: number; width: number; height: number } {
  const box = clampPrintPosition(printPosition)
  const scaleX = imageWidth / box.area_width
  const scaleY = imageHeight / box.area_height
  return clampExtractRegion(imageWidth, imageHeight, {
    left: Math.round(box.left * scaleX),
    top: Math.round(box.top * scaleY),
    width: Math.round(box.width * scaleX),
    height: Math.round(box.height * scaleY),
  })
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

  const meta = await sharp(printAreaPng).metadata()
  const imgW = meta.width || box.area_width
  const imgH = meta.height || box.area_height
  const extract = resolvePrintAreaExtractBox(imgW, imgH, box)

  const art = await sharp(printAreaPng)
    .extract(extract)
    .resize(rect.width, rect.height, { fit: "fill" })
    .png()
    .toBuffer()

  const templateBuf = await fetchImageBuffer(String(template.image_url))
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
