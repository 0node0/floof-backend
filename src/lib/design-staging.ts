/**
 * Design file staging for Printful file library (public HTTPS URL).
 * Prefers Cloudflare R2 when configured; falls back to in-memory (single-node).
 */

import {
  getDesignFromR2,
  isR2StagingEnabled,
  publicR2DesignUrl,
  putDesignToR2,
  readR2ConfigFromEnv,
} from "./design-r2"

type Entry = {
  buffer: Buffer
  contentType: string
  filename: string
  expiresAt: number
}

const store = new Map<string, Entry>()
const TTL_MS = 30 * 60 * 1000 // 30 minutes

function cleanup() {
  const now = Date.now()
  for (const [id, e] of store) {
    if (now > e.expiresAt) store.delete(id)
  }
}

function newDesignId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export async function stageDesignFile(opts: {
  buffer: Buffer
  contentType?: string
  filename?: string
}): Promise<string> {
  cleanup()
  const id = newDesignId()
  const contentType = opts.contentType || "image/png"
  const filename = opts.filename || "design.png"

  if (isR2StagingEnabled()) {
    await putDesignToR2(id, opts.buffer, contentType)
    return id
  }

  store.set(id, {
    buffer: opts.buffer,
    contentType,
    filename,
    expiresAt: Date.now() + TTL_MS,
  })
  return id
}

export async function getStagedDesign(
  id: string
): Promise<{ buffer: Buffer; contentType: string; filename: string } | null> {
  cleanup()
  const mem = store.get(id)
  if (mem) {
    if (Date.now() > mem.expiresAt) {
      store.delete(id)
    } else {
      return {
        buffer: mem.buffer,
        contentType: mem.contentType,
        filename: mem.filename,
      }
    }
  }

  const r2 = await getDesignFromR2(id)
  if (r2) {
    return { ...r2, filename: "design.png" }
  }
  return null
}

export function publicDesignUrl(id: string): string {
  const r2 = readR2ConfigFromEnv()
  if (r2) {
    return publicR2DesignUrl(r2, id)
  }
  const base = (
    process.env.MEDUSA_BACKEND_URL ||
    process.env.BACKEND_URL ||
    "http://localhost:9000"
  ).replace(/\/$/, "")
  return `${base}/floof/design-files/${id}`
}
