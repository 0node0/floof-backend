import { describe, it, expect } from "vitest"
import {
  findExistingVariantForPrintfulSync,
  planIdempotentVariantSync,
  printfulSyncVariantSku,
} from "../../lib/medusa-printful-variant-sync"

describe("medusa-printful-variant-sync", () => {
  it("builds PF- SKU from Printful sync variant id", () => {
    expect(printfulSyncVariantSku(5568638138)).toBe("PF-5568638138")
  })

  it("matches existing variant by SKU first", () => {
    const existing = [
      { id: "variant_a", sku: "PF-100", metadata: {} },
      { id: "variant_b", sku: "PF-200", metadata: { printful_sync_variant_id: 200 } },
    ]
    const match = findExistingVariantForPrintfulSync(existing, {
      sku: "PF-100",
      syncVariantId: 999,
    })
    expect(match?.id).toBe("variant_a")
  })

  it("matches existing variant by printful_sync_variant_id metadata", () => {
    const existing = [
      { id: "variant_b", sku: "legacy-sku", metadata: { printful_sync_variant_id: 5568638138 } },
    ]
    const match = findExistingVariantForPrintfulSync(existing, {
      sku: "PF-5568638138",
      syncVariantId: 5568638138,
    })
    expect(match?.id).toBe("variant_b")
  })

  it("plans updates for existing SKUs and creates only missing variants", () => {
    const existing = [{ id: "v1", sku: "PF-1", metadata: {} }]
    const plan = planIdempotentVariantSync(existing, [
      {
        title: "ONE SIZE / WHITE",
        sku: "PF-1",
        syncVariantId: 1,
        options: { Size: "ONE SIZE", Color: "WHITE" },
        prices: [{ amount: 2200, currency_code: "usd" }],
        metadata: {
          printful_sync_variant_id: 1,
          printful_catalog_variant_id: 10,
        },
      },
      {
        title: "ONE SIZE / BLACK",
        sku: "PF-2",
        syncVariantId: 2,
        options: { Size: "ONE SIZE", Color: "BLACK" },
        prices: [{ amount: 2200, currency_code: "usd" }],
        metadata: {
          printful_sync_variant_id: 2,
          printful_catalog_variant_id: 11,
        },
      },
    ])
    expect(plan.toUpdate).toHaveLength(1)
    expect(plan.toUpdate[0].existingId).toBe("v1")
    expect(plan.toCreate).toHaveLength(1)
    expect(plan.toCreate[0].sku).toBe("PF-2")
  })
})
