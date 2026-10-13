import type { MugWrapDimensions } from "./mug-wrap-composite"
import {
  fetchAndAssertSingleSidedDesignPng,
  MugWrapSourceRefusedError,
} from "./mug-design-source"

export { isMugWrapImageDimensions, isLikelyMugWrapAssetUrl } from "./mug-wrap-asset-detect"
export { MugWrapSourceRefusedError }

/**
 * Load single-sided artwork for wrap compositing. Refuses existing wrap files
 * (never extract/re-composite — PR #16 regression).
 */
export async function resolveSingleSidedArtPngForWrap(
  designUrl: string,
  _dims: MugWrapDimensions,
  log?: (m: string) => void
): Promise<Buffer> {
  return fetchAndAssertSingleSidedDesignPng(designUrl, log)
}
