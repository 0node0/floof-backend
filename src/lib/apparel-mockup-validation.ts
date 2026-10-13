import sharp from "sharp"

export type MockupPixelDiff = {
  differingPixels: number
  totalPixels: number
  ratio: number
}

/** Compare two mockup JPEG/PNG buffers; ratio is fraction of pixels that differ noticeably. */
export async function mockupPixelDifference(
  mockupA: Buffer,
  mockupB: Buffer,
  threshold = 18
): Promise<MockupPixelDiff> {
  const size = 256
  const a = await sharp(mockupA)
    .resize(size, size, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer()
  const b = await sharp(mockupB)
    .resize(size, size, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer()
  const channels = 3
  const totalPixels = size * size
  let differing = 0
  for (let i = 0; i < totalPixels; i++) {
    const o = i * channels
    const dr = Math.abs(a[o] - b[o])
    const dg = Math.abs(a[o + 1] - b[o + 1])
    const db = Math.abs(a[o + 2] - b[o + 2])
    if (dr + dg + db > threshold) differing++
  }
  return {
    differingPixels: differing,
    totalPixels,
    ratio: differing / totalPixels,
  }
}

export async function fetchImageBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch mockup image (${res.status})`)
  }
  return Buffer.from(await res.arrayBuffer())
}

export function mockupShowsDesign(diff: MockupPixelDiff, minRatio = 0.008): boolean {
  return diff.ratio >= minRatio
}
