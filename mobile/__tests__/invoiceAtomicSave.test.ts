import type { Client, InvoiceDraft } from '../src/domain/entities'
import { createInvoiceBundleSaveOperation, matchClientByName } from '../src/features/invoices/saveInvoiceBundle'

const OWNER = 'owner-invoice'
const draft: InvoiceDraft = {
  clientName: 'Mina Garcia', jobTitle: 'Replace shutoff valve', tradeType: 'Plumbing',
  taxBasisPoints: 825, paymentTerms: 'Due on receipt',
  lineItems: [{ description: 'Labor', type: 'labor', quantity: 1500, unitPriceCents: 10_000 }],
}

it('writes client, job, invoice, and one compound outbox envelope atomically', async () => {
  const transactLocalMutation = jest.fn(async (_mutation: unknown) => {})
  const ids = [
    '00000000-0000-4000-8000-000000000901',
    '00000000-0000-4000-8000-000000000902',
    '00000000-0000-4000-8000-000000000903',
    '00000000-0000-4000-8000-000000000904',
  ]
  const operation = createInvoiceBundleSaveOperation(draft, {
    ownerId: OWNER, repository: { transactLocalMutation },
    createId: () => ids.shift()!, now: () => '2026-08-06T12:00:00.000Z',
  })

  await expect(operation.save()).resolves.toEqual(operation.ids)
  expect(transactLocalMutation).toHaveBeenCalledTimes(1)
  const mutation = transactLocalMutation.mock.calls[0][0]
  expect(mutation).toMatchObject({
    id: operation.ids.mutationId, kind: 'save_invoice_bundle', entity: 'invoice',
    entityId: operation.ids.invoiceId, ownerId: OWNER,
    payload: {
      client: { id: operation.ids.clientId, ownerId: OWNER, syncState: 'pending' },
      job: { id: operation.ids.jobId, clientId: operation.ids.clientId, status: 'Invoiced' },
      invoice: {
        id: operation.ids.invoiceId, clientId: operation.ids.clientId,
        jobId: operation.ids.jobId, subtotalCents: 15_000, taxCents: 1_238, totalCents: 16_238,
      },
    },
  })
})

it('retries with byte-stable IDs and mutation content after local failure', async () => {
  const transactLocalMutation = jest.fn()
    .mockRejectedValueOnce(new Error('disk busy'))
    .mockResolvedValueOnce(undefined)
  let idCalls = 0
  const operation = createInvoiceBundleSaveOperation(draft, {
    ownerId: OWNER, repository: { transactLocalMutation },
    createId: () => `00000000-0000-4000-8000-${String(++idCalls).padStart(12, '0')}`,
    now: () => '2026-08-06T12:00:00.000Z',
  })
  await expect(operation.save()).rejects.toThrow('disk busy')
  await expect(operation.save()).resolves.toEqual(operation.ids)
  expect(transactLocalMutation.mock.calls[1][0]).toEqual(transactLocalMutation.mock.calls[0][0])
  expect(idCalls).toBe(4)
})

it('matches an existing client without discarding its contact fields', () => {
  const existing: Client = {
    id: 'client-existing', ownerId: OWNER, name: 'Mina García', email: 'mina@example.test',
    version: 4, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z', syncState: 'current',
  }
  expect(matchClientByName([existing], '  MINA GARCI\u0301A ')).toBe(existing)
})
