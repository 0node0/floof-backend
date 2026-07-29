/**
 * Short-lived in-memory file staging so Printful can fetch uploaded PNGs
 * from a public backend URL. Single-node Railway is fine; not multi-replica safe.
 */

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

export function stageDesignFile(opts: {
  buffer: Buffer
  contentType?: string
  filename?: string
}): string {
  cleanup()
  const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  store.set(id, {
    buffer: opts.buffer,
    contentType: opts.contentType || "image/png",
    filename: opts.filename || "design.png",
    expiresAt: Date.now() + TTL_MS,
  })
  return id
}

export function getStagedDesign(id: string): Entry | null {
  cleanup()
  const e = store.get(id)
  if (!e) return null
  if (Date.now() > e.expiresAt) {
    store.delete(id)
    return null
  }
  return e
}

export function publicDesignUrl(id: string): string {
  const base = (
    process.env.MEDUSA_BACKEND_URL ||
    process.env.BACKEND_URL ||
    "http://localhost:9000"
  ).replace(/\/$/, "")
  return `${base}/floof/design-files/${id}`
}
