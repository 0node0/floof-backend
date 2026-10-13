import type PrintfulApiClient from "../modules/printful/client"
import { withPrintfulRetries } from "./printful-retry"

export type SyncVariantFileRef = { fileId: number; type: string }

export function syncVariantFilesMatch(
  existing: Array<{ id?: number; type?: string }> | undefined,
  expected: SyncVariantFileRef[]
): boolean {
  for (const exp of expected) {
    const file = (existing || []).find(
      (f) =>
        f.type === exp.type ||
        (exp.type === "default" && (f.type === "default" || f.type === "front"))
    )
    if (file?.id !== exp.fileId) return false
  }
  return true
}

export async function updateSyncVariantsPrintFilesIdempotent(
  client: PrintfulApiClient,
  printfulProductId: number,
  syncVariants: Array<{
    id: number
    retail_price?: string
    files?: Array<{ id?: number; type?: string }>
  }>,
  expectedFiles: SyncVariantFileRef[],
  log?: (m: string) => void
): Promise<{ updated: number; skipped: number }> {
  const needsUpdate = syncVariants.filter(
    (sv) => !syncVariantFilesMatch(sv.files, expectedFiles)
  )
  if (!needsUpdate.length) {
    log?.(`Sync variants already have expected print files — skipping PUT`)
    return { updated: 0, skipped: syncVariants.length }
  }

  const payload = {
    sync_variants: needsUpdate.map((sv) => ({
      id: sv.id,
      retail_price: sv.retail_price,
      files: expectedFiles.map((f) => ({ id: f.fileId, type: f.type })),
    })),
  }
  log?.(
    `PUT /store/products/${printfulProductId} — set print files on ${needsUpdate.length}/${syncVariants.length} variant(s)`
  )
  await withPrintfulRetries(
    `PUT sync product ${printfulProductId}`,
    log ?? (() => undefined),
    () => client.put(`/store/products/${printfulProductId}`, payload)
  )
  return { updated: needsUpdate.length, skipped: syncVariants.length - needsUpdate.length }
}
