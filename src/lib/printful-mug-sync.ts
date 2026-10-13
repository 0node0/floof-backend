import type PrintfulApiClient from "../modules/printful/client"

export type SyncVariantFileReport = {
  syncVariantId: number
  catalogVariantId?: number
  printfulFileId?: number
  compositeFileMatches: boolean
}

export function buildSyncVariantFileReports(
  syncVariants: Array<{
    id: number
    variant_id?: number
    files?: Array<{ id?: number; type?: string }>
  }>,
  expectedCompositeFileId: number,
  syncFileType = "default"
): SyncVariantFileReport[] {
  return syncVariants.map((sv) => {
    const file = (sv.files || []).find(
      (f) => f.type === syncFileType || f.type === "default" || f.type === "front"
    )
    const fileId = file?.id
    return {
      syncVariantId: sv.id,
      catalogVariantId: sv.variant_id,
      printfulFileId: fileId,
      compositeFileMatches: fileId === expectedCompositeFileId,
    }
  })
}

export async function updateSyncVariantsPrintFile(
  client: PrintfulApiClient,
  printfulProductId: number,
  syncVariants: Array<{ id: number }>,
  fileId: number,
  syncFileType: string,
  log?: (m: string) => void
): Promise<void> {
  const payload = {
    sync_variants: syncVariants.map((sv) => ({
      id: sv.id,
      files: [{ id: fileId, type: syncFileType }],
    })),
  }
  log?.(
    `PUT /store/products/${printfulProductId} — set ${syncFileType} file id=${fileId} on ${syncVariants.length} variant(s)`
  )
  await client.put(`/store/products/${printfulProductId}`, payload)
}
