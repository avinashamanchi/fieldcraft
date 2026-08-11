import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { draftFromLocalJobNote } from '../app/invoices/new'

const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8')

it('keeps the credential-free Maestro flow on semantic IDs and local manual entry', () => {
  const flow = read('e2e/fieldcraft-core.yaml')
  expect(flow).toContain('appId: com.avinashamanchi.fieldcraft')
  expect(flow).toContain('clearState: false')
  for (const id of ['log-job', 'manual-job-entry', 'review-invoice', 'save-invoice', 'tab-jobs', 'job-row-0']) {
    expect(flow).toContain(`id: "${id}"`)
  }
  expect(flow).not.toMatch(/point:|\d+%,\d+%|password|@example\./i)
})

it('turns the tracked local note into an editable, deterministic offline draft', () => {
  const draft = draftFromLocalJobNote('Replace valve for Jordan, two hours labor and one $25 valve')
  expect(draft).toMatchObject({ clientName: 'Jordan', jobTitle: 'Replace valve', jobDescription: expect.stringContaining('two hours') })
  expect(draft.lineItems).toEqual([
    expect.objectContaining({ description: 'Labor', quantity: 2_000, type: 'labor', unitPriceCents: 0 }),
    expect.objectContaining({ description: 'valve', quantity: 1_000, type: 'material', unitPriceCents: 2_500 }),
  ])
})

it('wires every tracked ID to the mobile source without embedding credentials', () => {
  const sources = [
    read('app/(tabs)/index.tsx'), read('app/invoices/new.tsx'), read('app/invoices/review.tsx'),
    read('app/(tabs)/_layout.tsx'), read('app/(tabs)/jobs.tsx'),
  ].join('\n')
  for (const id of ['log-job', 'manual-job-entry', 'review-invoice', 'save-invoice', 'tab-jobs', 'job-row-']) expect(sources).toContain(id)
  expect(sources).not.toMatch(/service_role|gsk_[A-Za-z0-9]/)
})
