import type PrintfulApiClient from "../modules/printful/client"
import { isDurableProductImageUrl } from "./ephemeral-floof-image-url"
import { pickFullResolutionPrintfulFileUrl } from "./printful-file-url"
import { sleep } from "./async-sleep"

export type RehostImageOptions = {
  /** When true, throw instead of returning the original URL on failure. */
  strict?: boolean
}

/** Upload an external mockup URL into Printful file library when it is not already on files.cdn. */
export async function rehostImageUrlViaPrintful(
  client: PrintfulApiClient,
  url: string,
  log: (m: string) => void,
  opts?: RehostImageOptions
): Promise<string> {
  const strict = opts?.strict === true
  const trimmed = url?.trim()
  if (!trimmed) return url
  if (isDurableProductImageUrl(trimmed)) return trimmed
  try {
    const f = await client.post<{ id: number }>("/files", {
      url: trimmed,
      filename: `gallery-${Date.now()}.jpg`,
    })
    for (let i = 0; i < 20; i++) {
      const polled = await client.get<{
        status?: string
        url?: string
        preview_url?: string
        thumbnail_url?: string
      }>(`/files/${f.id}`)
      const picked = pickFullResolutionPrintfulFileUrl(polled)
      const st = String(polled.status || "").toLowerCase()
      if (picked && isDurableProductImageUrl(picked)) {
        return picked
      }
      if (st === "ok" || st === "ready") {
        const fallback =
          polled.preview_url || polled.thumbnail_url || polled.url || trimmed
        if (isDurableProductImageUrl(fallback)) return fallback
        if (strict) {
          throw new Error(
            `Printful file ${f.id} ready but URL is not durable file-library CDN: ${fallback.slice(0, 120)}`
          )
        }
        return fallback
      }
      if (st === "failed" || st === "error") {
        throw new Error(`Printful file ${f.id} processing failed (status=${st})`)
      }
      await sleep(1000)
    }
    throw new Error(`Printful file ${f.id} timed out waiting for durable CDN URL`)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (strict) {
      throw new Error(`Could not rehost image via Printful: ${msg}`)
    }
    log(`Could not rehost image (${msg}) — keeping original`)
  }
  return trimmed
}
