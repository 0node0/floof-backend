import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Seed script — creates a default sales channel, US region, and a
 * publishable API key so the storefront can talk to the Store API.
 *
 * Products come from Printful sync (yarn seed after adding products
 * to Printful), or the storefront shows an empty state.
 */
export default async function seed({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const regionService = container.resolve(Modules.REGION)
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL)
  const apiKeyService = container.resolve(Modules.API_KEY)

  logger.info("--- Floof Seed ---")

  // Default sales channel
  let channel = (await salesChannelService.listSalesChannels({ name: "Default Sales Channel" }))[0]
  if (!channel) {
    channel = await salesChannelService.createSalesChannels({
      name: "Default Sales Channel",
      description: "Default Floof sales channel",
    })
    logger.info("Created default sales channel")
  }

  // US region with Stripe as payment provider
  let region = (await regionService.listRegions({ name: "United States" }))[0]
  if (!region) {
    region = await regionService.createRegions({
      name: "United States",
      currency_code: "usd",
      countries: ["us"],
      payment_providers: ["stripe"],
    })
    logger.info("Created US region")
  }

  // Publishable API key
  const keys = await apiKeyService.listApiKeys({ type: "publishable" })
  if (keys.length === 0) {
    const key = await apiKeyService.createApiKeys({
      title: "Floof Storefront",
      type: "publishable",
      created_by: "seed",
    })
    logger.info(`Created publishable API key: ${key.token}`)
  } else {
    logger.info(`Publishable API key already exists: ${keys[0].token}`)
  }

  logger.info("--- Seed complete ---")
  logger.info("Products sync from Printful. Run `yarn seed` after adding products to Printful.")
}