import type PrintfulApiClient from "../modules/printful/client"
import { sleep } from "./async-sleep"

/** Upload an external mockup URL into Printful file library when it is not already on files.cdn. */
export async function rehostImageUrlViaPrintful(
  client: PrintfulApiClient,
  url: string,
  log: (m: string) => void
): Promise<string> {
  const trimmed = url?.trim()
  if (!trimmed) return url
  if (trimmed.includes("files.cdn.printful.com/files/")) return trimmed
  try {
    const f = await client.post<{ id: number }>("/files", {
      url: trimmed,
      filename: `gallery-${Date.now()}.jpg`,
    })
    for (let i = 0; i < 15; i++) {
      const polled = await client.get<{
        status?: string
        preview_url?: string
        thumbnail_url?: string
        url?: string
      }>(`/files/${f.id}`)
      if (polled.status === "ok" || polled.status === "ready") {
        return polled.preview_url || polled.thumbnail_url || polled.url || trimmed
      }
      if (polled.status === "failed" || polled.status === "error") break
      await sleep(1000)
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    log(`Could not rehost image (${msg}) — keeping original`)
  }
  return trimmed
}
