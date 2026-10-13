import sharp from "sharp"

/** Remove transparent margins so centred/back art can fill the placement box. */
export async function trimTransparentPng(png: Buffer): Promise<Buffer> {
  const trimmed = await sharp(png).trim().png().toBuffer()
  const meta = await sharp(trimmed).metadata()
  if (!meta.width || !meta.height) {
    return png
  }
  return trimmed
}

export type ScaleToBoxResult = {
  width: number
  height: number
}

/** Scale art to fit inside boxW×boxH, filling the limiting dimension (may upscale). */
export function scaleToFitBox(
  srcW: number,
  srcH: number,
  boxW: number,
  boxH: number
): ScaleToBoxResult {
  const scale = Math.min(boxW / srcW, boxH / srcH)
  return {
    width: Math.max(1, Math.round(srcW * scale)),
    height: Math.max(1, Math.round(srcH * scale)),
  }
}
