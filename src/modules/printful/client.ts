import { createHmac } from "crypto"

export class PrintfulApiClient {
  private baseUrl = "https://api.printful.com"
  private apiToken: string

  constructor(apiToken: string) {
    this.apiToken = apiToken
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

  /**
   * Generate a base64 HMAC-SHA256 signature of a raw webhook body.
   * Printful's webhook signing uses the same algorithm with the secret
   * you configured in your Printful store's webhook settings.
   */
  signWebhookBody(rawBody: string, secret: string): string {
    return createHmac("sha256", secret).update(rawBody).digest("base64")
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      "X-PF-Store-Id": "",
    }
  }
}

export default PrintfulApiClient
