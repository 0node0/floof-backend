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
    return this.parse<T>(res, `GET ${path}`)
  }

  async post<T = any>(path: string, data: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    return this.parse<T>(res, `POST ${path}`)
  }

  async put<T = any>(path: string, data: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "PUT",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    return this.parse<T>(res, `PUT ${path}`)
  }

  async delete<T = any>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "DELETE",
      headers: this.headers(),
    })
    return this.parse<T>(res, `DELETE ${path}`)
  }

  private async parse<T>(res: Response, label: string): Promise<T> {
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Printful ${label} -> ${res.status}: ${body}`)
    }
    const json = await res.json()
    return (json.result ?? json) as T
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.apiToken}`,
    }
    if (this.storeId) {
      h["X-PF-Store-Id"] = this.storeId
    }
    return h
  }
}

export default PrintfulApiClient
