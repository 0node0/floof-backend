import PrintfulApiClient from "./client"

type PrintfulModuleOptions = {
  apiToken: string
}

type FloofCategory = "tees" | "hoodies" | "hats" | "accessories"

function deriveCategory(printfulType: string | undefined): FloofCategory {
  const t = (printfulType || "").toLowerCase()
  if (t.includes("hoodie") || t.includes("sweatshirt")) return "hoodies"
  if (t.includes("hat") || t.includes("cap") || t.includes("beanie")) return "hats"
  if (t.includes("sticker") || t.includes("mug") || t.includes("poster") || t.includes("tote")) return "accessories"
  return "tees"
}

function derivePhrase(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join(" ")
}

export class PrintfulModuleService {
  private client: PrintfulApiClient
  public readonly identifier = "printful"

  constructor(_container: any, options: PrintfulModuleOptions) {
    this.client = new PrintfulApiClient(options.apiToken)
  }

  // ---- Catalog ----

  async listProducts(): Promise<any[]> {
    const res = await this.client.get<any>("/store/products?status=synced")
    return res || []
  }

  async getProduct(productId: number): Promise<any> {
    return await this.client.get(`/store/products/${productId}`)
  }

  // ---- Shipping rates ----

  async getShippingRates(
    recipient: {
      address1: string
      city: string
      state_code: string
      country_code: string
      zip: string
    },
    items: { variant_id: number; quantity: number }[]
  ): Promise<any[]> {
    const res = await this.client.post<any>("/shipping/rates", { recipient, items })
    return res || []
  }

  // ---- Orders ----

  async createOrder(payload: {
    external_id: string
    recipient: Record<string, string>
    items: { external_variant_id: string; quantity: number; retail_price: string }[]
  }): Promise<any> {
    return await this.client.post("/orders", payload)
  }

  async confirmOrder(orderId: number): Promise<any> {
    return await this.client.post(`/orders/${orderId}/confirm`, {})
  }

  async getOrder(orderId: number): Promise<any> {
    return await this.client.get(`/orders/${orderId}`)
  }

  async cancelOrder(orderId: number): Promise<any> {
    return await this.client.post(`/orders/${orderId}/cancel`, {})
  }

  // ---- Sync mapping ----

  /**
   * Map a Printful product to a Medusa product shape.
   * Adds `category` and `phrase` so the storefront can render
   * the right category bucket and short tagline.
   */
  async getProductForSync(printfulProductId: number): Promise<{
    title: string
    handle: string
    description: string
    images: { url: string }[]
    variants: {
      title: string
      sku: string
      prices: { amount: number; currency_code: string }[]
      options: Record<string, string>
      metadata: { printful_variant_id: number }
    }[]
    options: { title: string; values: string[] }[]
    metadata: { printful_product_id: number; category: FloofCategory; phrase: string }
    category: FloofCategory
    phrase: string
  } | null> {
    try {
      const product = await this.getProduct(printfulProductId)
      if (!product) return null

      const category = deriveCategory(product.type || product.product?.type)
      const phrase = derivePhrase(product.name)

      const variants = (product.variants || []).map((v: any) => ({
        title: v.name,
        sku: `PF-${v.id}`,
        prices: [
          {
            amount: Math.round(parseFloat(v.price || "0") * 100),
            currency_code: "usd",
          },
        ],
        options: (v.options || []).reduce((acc: Record<string, string>, o: any) => {
          acc[o.name] = o.value
          return acc
        }, {}),
        metadata: { printful_variant_id: v.id },
      }))

      const optionMap = new Map<string, Set<string>>()
      for (const v of variants) {
        for (const [name, value] of Object.entries(v.options) as [string, string][]) {
          if (!optionMap.has(name)) optionMap.set(name, new Set())
          optionMap.get(name)!.add(value)
        }
      }

      return {
        title: product.name,
        handle: product.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
        description:
          product.description || `Premium ${product.name} from Floof — printed fresh, ships from the US.`,
        images: product.product?.image ? [{ url: product.product.image }] : [],
        variants,
        options: Array.from(optionMap.entries()).map(([title, values]) => ({
          title,
          values: Array.from(values),
        })),
        metadata: { printful_product_id: printfulProductId, category, phrase },
        category,
        phrase,
      }
    } catch (err: any) {
      console.error(`[printful] Failed to get product ${printfulProductId}: ${err.message}`)
      return null
    }
  }
}

export default PrintfulModuleService
