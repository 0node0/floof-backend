/** Turn thrown values (including Medusa workflow objects) into a log-safe string. */
export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message
    if (typeof msg === "string" && msg.trim()) return msg
    if (msg !== undefined && msg !== null) {
      try {
        return JSON.stringify(msg)
      } catch {
        return String(msg)
      }
    }
    return error.name || "Error"
  }
  if (typeof error === "string") return error
  if (error === null || error === undefined) return String(error)
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
