import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { maintainMugDesignProducts } from "../lib/maintain-mug-products"

/**
 * Regenerate Printful lifestyle mockups for existing mug products and strip
 * legacy "FLOOF —" prefixes from Medusa titles.
 *
 * Usage:
 *   yarn regenerate:mug-mockups
 *
 * Optional env:
 *   DRY_RUN=1                    — log only, no writes
 *   STRIP_FLOOF_PREFIX=0         — skip title cleanup (default: strip)
 *   REGENERATE_MOCKUPS=0         — skip mockup regen (default: regenerate)
 *   PRODUCT_IDS=id1,id2          — limit to specific Medusa product ids
 *   MUG_CATALOG_PRODUCT_IDS=19,483 — catalog ids treated as mugs when metadata matches
 */
export default async function regenerateMugMockups({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const dryRun = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true"
  const stripFloofPrefix = process.env.STRIP_FLOOF_PREFIX !== "0"
  const regenerateMockups = process.env.REGENERATE_MOCKUPS !== "0"
  const productIds = process.env.PRODUCT_IDS
    ? process.env.PRODUCT_IDS.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined

  logger.info("--- Maintain mug design products ---")
  const result = await maintainMugDesignProducts(container, {
    dryRun,
    stripFloofPrefix,
    regenerateMockups,
    productIds,
  })

  for (const line of result.logs) logger.info(line)
  logger.info(
    `Done: mugs=${result.mugMatched} titlesUpdated=${result.titlesUpdated} mockupsRegenerated=${result.mockupsRegenerated} errors=${result.errors.length}`
  )
  if (result.errors.length) {
    for (const err of result.errors) {
      logger.error(`${err.productId}: ${err.error}`)
    }
    throw new Error("Maintenance completed with errors")
  }
}
