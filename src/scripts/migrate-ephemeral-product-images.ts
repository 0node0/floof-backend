import type { ExecArgs } from "@medusajs/framework/types"
import { migrateEphemeralProductImages } from "../lib/migrate-ephemeral-product-images"

/**
 * Rehost product gallery images from Railway `/static` disk (or /floof/design-files) to R2 or Printful CDN.
 *
 *   medusa exec ./src/scripts/migrate-ephemeral-product-images.ts
 *
 * Env:
 *   DRY_RUN=true
 *   HANDLE_PREFIX=flower-crown-
 */
export default async function run({ container }: ExecArgs) {
  const dryRun = process.env.DRY_RUN === "true" || process.env.DRY_RUN === "1"
  const handlePrefix = process.env.HANDLE_PREFIX || undefined

  const result = await migrateEphemeralProductImages(container, {
    dryRun,
    handlePrefix,
  })

  console.log(JSON.stringify(result, null, 2))
}
