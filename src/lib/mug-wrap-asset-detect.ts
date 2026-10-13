/** Full mug wrap (e.g. 2700×1050) — not single-sided artwork. */
export function isMugWrapImageDimensions(width: number, height: number): boolean {
  if (width < 500 || height < 200) return false
  const ratio = width / height
  return ratio >= 2.2 && width >= height * 2
}

export function isLikelyMugWrapAssetUrl(url: string): boolean {
  return /mug-wrap-\d+x\d+/i.test(url) || /wrap.*2700/i.test(url)
}
