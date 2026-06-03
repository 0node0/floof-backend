import { Module } from "@medusajs/framework/utils"
import PrintfulModuleService from "./service"

export default Module("printful", {
  service: PrintfulModuleService,
})
