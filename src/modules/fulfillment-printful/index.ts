import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import PrintfulFulfillmentService from "./service"

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [PrintfulFulfillmentService],
})
