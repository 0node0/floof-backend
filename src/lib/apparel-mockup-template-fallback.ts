import sharp from "sharp"
import type PrintfulApiClient from "../modules/printful/client"
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

export async function compositePrintAreaOntoLayoutTemplate(
  template: LayoutTemplate,
  printAreaPng: Buffer
): Promise<Buffer> {
  const templateW = template.template_width || 560
  const templateH = template.template_height || 295
  const areaW = template.print_area_width || templateW
  const areaH = template.print_area_height || templateH
  const areaLeft = template.print_area_left || 0
  const areaTop = template.print_area_top || 0

  const templateBuf = await fetchImageBuffer(String(template.image_url))
  const scaledPrint = await sharp(printAreaPng)
    .resize(areaW, areaH, { fit: "fill" })
    .png()
    .toBuffer()

  return sharp(templateBuf)
    .resize(templateW, templateH, { fit: "fill" })
    .composite([{ input: scaledPrint, left: areaLeft, top: areaTop }])
    .jpeg({ quality: 92 })
    .toBuffer()
}

export async function generateTemplateFallbackMockup(opts: {
  client: PrintfulApiClient
  catalogProductId: number
  variantId: number
  placement: string
  printAreaPng: Buffer
  log: (m: string) => void
}): Promise<string> {
  const templates = await loadMockupTemplates(opts.client, opts.catalogProductId)
  const layout = findLayoutTemplateForVariant(templates, opts.variantId, opts.placement)
  if (!layout?.image_url) {
    throw new Error(`No layout template for placement=${opts.placement} variant=${opts.variantId}`)
  }
  const jpeg = await compositePrintAreaOntoLayoutTemplate(layout, opts.printAreaPng)
  const uploaded = await uploadBinaryToPrintfulFileLibrary(
    opts.client,
    jpeg,
    `apparel-template-mockup-${opts.placement}-${opts.variantId}.jpg`,
    "image/jpeg",
    opts.log
  )
  return uploaded.cdnUrl
}
