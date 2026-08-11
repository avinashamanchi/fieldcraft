import { render, screen } from '@testing-library/react-native'
import { Text } from 'react-native'

import { VirtualizedEntityList } from '../src/components/VirtualizedEntityList'
import {
  buildInventoryMutation,
  buildServiceMutation,
  InventoryDraftSchema,
  ServiceDraftSchema,
} from '../src/features/catalog/catalogForm'

const OWNER = 'owner-a'

it('builds server-compatible service and inventory mutations at exact limits', () => {
  const service = buildServiceMutation({
    draft: { name: 'Diagnostic', description: '', estimatedHoursThousandths: 10_000, unitPriceCents: 100_000_000, category: 'Labor' },
    entityId: 'service-a', mutationId: '00000000-0000-4000-8000-000000000821', now: '2026-08-06T10:00:00.000Z', ownerId: OWNER,
  })
  const inventory = buildInventoryMutation({
    draft: { name: 'Copper fitting', quantityThousandths: 10_000, unit: 'each', minStockThousandths: 2_000, unitPriceCents: 499 },
    entityId: 'inventory-a', mutationId: '00000000-0000-4000-8000-000000000822', now: '2026-08-06T10:00:00.000Z', ownerId: OWNER,
  })
  expect(service.payload).toMatchObject({ estimatedHoursThousandths: 10_000 })
  expect(inventory.payload).toMatchObject({ unit: 'each', quantityThousandths: 10_000 })
  expect(() => ServiceDraftSchema.parse({ ...(service.payload as object), name: 'x'.repeat(201) })).toThrow()
  expect(() => InventoryDraftSchema.parse({ ...(inventory.payload as object), unit: 'x'.repeat(33) })).toThrow()
})

it('uses a virtualized stable-ID list for 200 records', () => {
  const data = Array.from({ length: 200 }, (_, index) => ({ id: `record-${index}`, name: `Record ${index}` }))
  render(
    <VirtualizedEntityList
      data={data}
      emptyMessage="No records"
      renderItem={({ item }) => <Text>{item.name}</Text>}
    />,
  )
  const list = screen.getByTestId('virtualized-entity-list')
  expect(list.props.data).toHaveLength(200)
  expect(list.props.keyExtractor(data[42])).toBe('record-42')
  expect(list.props.initialNumToRender).toBeLessThan(200)
})
