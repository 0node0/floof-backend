import {
  AbstractFulfillmentProviderService,
} from "@medusajs/framework/utils"
import { PrintfulApiClient } from "../printful/client"

type ModuleOptions = {
  apiToken: string
}

export class PrintfulFulfillmentService extends AbstractFulfillmentProviderService {
  static identifier = "printful-fulfillment"
  private client: PrintfulApiClient

  constructor(_container: any, options: ModuleOptions) {
    super()
    this.client = new PrintfulApiClient(options.apiToken)
  }

  async getFulfillmentOptions(): Promise<any[]> {
    return [
      { id: "PRINTFUL_STANDARD", name: "Printful Standard Shipping" },
      { id: "PRINTFUL_EXPRESS", name: "Printful Express Shipping" },
    ]
  }

  async validateFulfillmentData(optionData: any, data: any, _context: any): Promise<any> {
    return data
  }

  async validateOption(_data: any): Promise<boolean> {
    return true
  }

  async canCalculate(_data: any): Promise<boolean> {
    return true
  }

  async calculatePrice(
    _optionData: any,
    data: any,
    _context: any
  ): Promise<{ calculated_amount: number; is_calculated_price_tax_inclusive: boolean }> {
    return {
      calculated_amount: (data as any)?.calculated_rate ?? 0,
      is_calculated_price_tax_inclusive: false,
    }
  }

  async createFulfillment(_data: any, _items: any, _order: any, _fulfillment: any): Promise<any> {
    return { data: _data as Record<string, unknown>, labels: [] }
  }

  async cancelFulfillment(data: any): Promise<any> {
    return data
  }
}

export default PrintfulFulfillmentService
