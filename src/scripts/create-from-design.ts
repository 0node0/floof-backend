import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createProductFromDesign } from "../lib/product-from-design"

/**
 * CLI: create Printful + Medusa product from a public design URL.
 *
 * Usage:
 *   DESIGN_URL=https://…/art.png PRODUCT_NAME="Humidity Club" yarn create:from-design
 *
 * Optional env:
 *   GARMENT=tee|hoodie
 *   COLORS=Black,White
 *   SIZES=S,M,L,XL,2XL
 *   RETAIL_PRICE=28.00
 *   DESCRIPTION=…
 *   SKIP_MOCKUPS=1
 */
export default async function createFromDesign({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const designUrl = process.env.DESIGN_URL || ""
  const name = process.env.PRODUCT_NAME || ""
  const garment = process.env.GARMENT === "hoodie" ? "hoodie" : "tee"
  const colors = process.env.COLORS
    ? process.env.COLORS.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined
  const sizes = process.env.SIZES
    ? process.env.SIZES.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined
  const retailPrice = process.env.RETAIL_PRICE
  const description = process.env.DESCRIPTION
  const generateMockups = process.env.SKIP_MOCKUPS !== "1"

  if (!designUrl || !name) {
    logger.error(
      "Set DESIGN_URL and PRODUCT_NAME env vars. Example:\n" +
        '  DESIGN_URL=https://…/design.png PRODUCT_NAME="Humidity Club" yarn create:from-design'
    )
    throw new Error("DESIGN_URL and PRODUCT_NAME required")
  }

  logger.info(`--- Create from design: ${name} ---`)
  const result = await createProductFromDesign(
    {
      name,
      designUrl,
      garment,
      colors,
      sizes,
      retailPrice,
      description,
      generateMockups,
    },
    container
  )

  for (const line of result.logs) logger.info(line)
  logger.info(
    `Printful sync product: ${result.printful.syncProductId} (${result.printful.variantCount} variants)`
  )
  logger.info(`Mockups: ${result.mockups.length}`)
  if (result.medusa) {
    logger.info(
      `Medusa: ${result.medusa.productId} → https://www.floof.space/products/${result.medusa.handle}`
    )
  }
  logger.info("--- Done ---")
}
