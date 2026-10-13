import type PrintfulApiClient from "../modules/printful/client"
import { publicDesignUrl, stageDesignFile } from "./design-staging"
import { sleep } from "./async-sleep"

/** Stage PNG publicly, register with Printful file library, return CDN URL. */
export async function uploadPngToPrintfulFileLibrary(
  client: PrintfulApiClient,
  png: Buffer,
  filename: string,
  log?: (m: string) => void
): Promise<string> {
  const id = await stageDesignFile({
    buffer: png,
    contentType: "image/png",
    filename,
  })
  const publicUrl = publicDesignUrl(id)
  log?.(`Staged wrap composite: ${publicUrl.slice(0, 72)}…`)

  const created = await client.post<{ id: number; status?: string; url?: string }>("/files", {
    url: publicUrl,
    filename,
  })
  const fileId = created.id
  if (!fileId) {
    throw new Error("Printful /files did not return id")
  }

  for (let i = 0; i < 30; i++) {
    const f = await client.get<{
      status?: string
      url?: string
      preview_url?: string
      thumbnail_url?: string
    }>(`/files/${fileId}`)
    const st = String(f.status || "").toLowerCase()
    if (st === "ok" || st === "ready") {
      const cdn = f.preview_url || f.url || f.thumbnail_url
      if (cdn) return cdn
    }
    if (st === "failed" || st === "error") {
      throw new Error(`Printful file ${fileId} processing failed`)
    }
    await sleep(1000)
  }
  throw new Error(`Printful file ${fileId} timed out`)
}
