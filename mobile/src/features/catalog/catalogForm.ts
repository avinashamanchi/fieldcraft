import { z } from 'zod'

import type { InventoryItem, Service } from '../../domain/entities'
import { MAX_MONEY_CENTS, MAX_QUANTITY_THOUSANDTHS } from '../../domain/limits'
import type { MutationEnvelope } from '../../domain/sync'
import { codePointLength, recordMutation, type MutationBuildInput } from '../recordMutation'

const boundedText = (maximum: number, label: string) => z.string().trim().refine(
  (value) => codePointLength(value) <= maximum,
  `${label} must contain at most ${maximum} characters`,
)

export const ServiceDraftSchema = z.object({
  name: boundedText(200, 'Name').pipe(z.string().min(1, 'Enter a service name')),
  description: boundedText(4000, 'Description'),
  estimatedHoursThousandths: z.number().finite().int().min(0).max(MAX_QUANTITY_THOUSANDTHS),
  unitPriceCents: z.number().finite().int().min(0).max(MAX_MONEY_CENTS),
  category: boundedText(100, 'Category'),
}).strict()

export const InventoryDraftSchema = z.object({
  name: boundedText(200, 'Name').pipe(z.string().min(1, 'Enter an inventory name')),
  quantityThousandths: z.number().finite().int().min(0).max(MAX_QUANTITY_THOUSANDTHS),
  unit: boundedText(32, 'Unit').pipe(z.string().min(1, 'Enter a unit')),
  minStockThousandths: z.number().finite().int().min(0).max(MAX_QUANTITY_THOUSANDTHS),
  unitPriceCents: z.number().finite().int().min(0).max(MAX_MONEY_CENTS),
}).strict()

export type ServiceDraft = z.infer<typeof ServiceDraftSchema>
export type InventoryDraft = z.infer<typeof InventoryDraftSchema>

export const buildServiceMutation = (
  input: MutationBuildInput<Service> & { draft: ServiceDraft },
): MutationEnvelope => {
  const draft = ServiceDraftSchema.parse(input.draft)
  return recordMutation('service', input, {
    id: input.entityId, ownerId: input.ownerId, name: draft.name,
    unitPriceCents: draft.unitPriceCents,
    ...(draft.description ? { description: draft.description } : {}),
    estimatedHoursThousandths: draft.estimatedHoursThousandths,
    ...(draft.category ? { category: draft.category } : {}),
    version: input.current?.version ?? 1,
    createdAt: input.current?.createdAt ?? input.now,
    updatedAt: input.now, syncState: 'pending',
  })
}

export const buildInventoryMutation = (
  input: MutationBuildInput<InventoryItem> & { draft: InventoryDraft },
): MutationEnvelope => {
  const draft = InventoryDraftSchema.parse(input.draft)
  return recordMutation('inventory', input, {
    id: input.entityId, ownerId: input.ownerId, name: draft.name,
    quantityThousandths: draft.quantityThousandths, unit: draft.unit,
    minStockThousandths: draft.minStockThousandths, unitPriceCents: draft.unitPriceCents,
    version: input.current?.version ?? 1,
    createdAt: input.current?.createdAt ?? input.now,
    updatedAt: input.now, syncState: 'pending',
  })
}
