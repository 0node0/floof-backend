export class PrintfulApiClient {
  private baseUrl = "https://api.printful.com"
  private apiToken: string
  private storeId: string

  constructor(apiToken: string, storeId?: string) {
    this.apiToken = apiToken
    this.storeId = storeId || process.env.PRINTFUL_STORE_ID || ""
  }

  async get<T = any>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: this.headers(),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Printful GET ${path} -> ${res.status}: ${body}`)
    }
    const json = await res.json()
    return (json.result ?? json) as T
  }

  async post<T = any>(path: string, data: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Printful POST ${path} -> ${res.status}: ${body}`)
    }
    const json = await res.json()
    return (json.result ?? json) as T
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.apiToken}`,
    }
    // Private store tokens usually don't need this; OAuth / multi-store tokens do.
    if (this.storeId) {
      h["X-PF-Store-Id"] = this.storeId
    }
    return h
  }
}

export default PrintfulApiClient
