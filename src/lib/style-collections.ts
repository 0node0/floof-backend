import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  batchLinkProductsToCollectionWorkflow,
  createCollectionsWorkflow,
  updateCollectionsWorkflow,
} from "@medusajs/medusa/core-flows"

export type StyleCollectionMetadata = {
  style?: string
  tagline?: string
  description?: string
  hero_copy?: string
  accent_colors?: string[]
  seo_title?: string
  seo_description?: string
}

export type UpsertStyleCollectionInput = {
  handle: string
  title: string
  tagline?: string
  description?: string
  heroCopy?: string
  accentColors?: string[]
  seoTitle?: string
  seoDescription?: string
}

function slugHandle(handle: string): string {
  return handle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
}

function metadataFromInput(input: UpsertStyleCollectionInput): StyleCollectionMetadata {
  return {
    style: slugHandle(input.handle),
    tagline: input.tagline,
    description: input.description,
    hero_copy: input.heroCopy,
    accent_colors: input.accentColors,
    seo_title: input.seoTitle,
    seo_description: input.seoDescription,
  }
}

export async function upsertStyleCollection(
  container: MedusaContainer,
  input: UpsertStyleCollectionInput
) {
  const handle = slugHandle(input.handle)
  if (!handle) throw new Error("handle is required")
  if (!input.title?.trim()) throw new Error("title is required")

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: existing } = await query.graph({
    entity: "product_collection",
    fields: ["id", "handle", "title", "metadata"],
    filters: { handle },
  })

  const metadata = metadataFromInput({ ...input, handle })

  if (existing?.[0]) {
    const col = existing[0]
    await updateCollectionsWorkflow(container).run({
      input: {
        selector: { id: col.id },
        update: {
          title: input.title,
          metadata: {
            ...(col.metadata || {}),
            ...metadata,
            landing: metadata,
          },
        },
      },
    })
    return { id: col.id as string, handle, created: false }
  }

  const { result } = await createCollectionsWorkflow(container).run({
    input: {
      collections: [
        {
          title: input.title,
          handle,
          metadata: {
            ...metadata,
            landing: metadata,
          },
        },
      ],
    },
  })

  const created = result[0]
  return { id: created.id, handle: created.handle || handle, created: true }
}

export async function ensureStyleCollection(
  container: MedusaContainer,
  styleHandle: string
): Promise<{ id: string; handle: string }> {
  const handle = slugHandle(styleHandle)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: existing } = await query.graph({
    entity: "product_collection",
    fields: ["id", "handle", "title"],
    filters: { handle },
  })
  if (existing?.[0]) {
    return { id: existing[0].id as string, handle: existing[0].handle as string }
  }

  const title = handle
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")

  const { result } = await createCollectionsWorkflow(container).run({
    input: {
      collections: [
        {
          title,
          handle,
          metadata: { style: handle },
        },
      ],
    },
  })
  return { id: result[0].id, handle: result[0].handle || handle }
}

export async function linkProductToStyleCollection(
  container: MedusaContainer,
  collectionId: string,
  productId: string
) {
  await batchLinkProductsToCollectionWorkflow(container).run({
    input: {
      id: collectionId,
      add: [productId],
    },
  })
}
