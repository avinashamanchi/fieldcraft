import type { Client, Invoice, Job } from '../src/domain/entities'
import { buildInvoiceHtml, createInvoicePdf } from '../src/files/invoicePdf'

const invoice: Invoice = {
  id: 'invoice-1', ownerId: 'owner-a', clientId: 'client-1', jobId: 'job-1',
  draft: { clientName: 'Mina <script>', jobTitle: 'Valve & sink', tradeType: 'Plumbing', taxBasisPoints: 825, paymentTerms: 'Net 14', lineItems: [{ description: 'Labor', type: 'labor', quantity: 1500, unitPriceCents: 10_000 }], notes: 'Reviewed notes' },
  subtotalCents: 15_000, taxCents: 1_238, totalCents: 16_238,
  version: 1, createdAt: '2026-08-06T12:00:00.000Z', updatedAt: '2026-08-06T12:00:00.000Z', syncState: 'current',
}
const client: Client = { id: 'client-1', ownerId: 'owner-a', name: 'Mina', phone: 'PRIVATE_PHONE', email: 'PRIVATE_EMAIL', version: 1, createdAt: invoice.createdAt, updatedAt: invoice.updatedAt, syncState: 'current' }
const job: Job = { id: 'job-1', ownerId: 'owner-a', clientId: 'client-1', title: 'Valve', status: 'Invoiced', version: 1, createdAt: invoice.createdAt, updatedAt: invoice.updatedAt, syncState: 'current' }

it('renders required reviewed fields, escaped text, and integer-cent totals only', () => {
  const html = buildInvoiceHtml({ businessName: 'FieldCraft Plumbing', client, invoice, invoiceNumber: 'INV-001', job })
  for (const value of ['FieldCraft Plumbing', 'INV-001', 'Aug 6, 2026', 'Mina', 'Valve', 'Labor', '$150.00', '$12.38', '$162.38', 'Net 14', 'Reviewed notes']) expect(html).toContain(value)
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('PRIVATE_PHONE')
  expect(html).not.toContain('PRIVATE_EMAIL')
  expect(html).not.toMatch(/AI-generated|Invoice sent/i)
})

it('creates an owned PDF and rejects files over 10 MiB', async () => {
  const fileSystem = {
    cacheDirectory: 'file:///cache/', makeDirectoryAsync: jest.fn(async () => {}), moveAsync: jest.fn(async () => {}),
    getInfoAsync: jest.fn(async () => ({ exists: true, size: 1000 })), deleteAsync: jest.fn(async () => {}),
  }
  const artifact = await createInvoicePdf({ businessName: 'FieldCraft', client, invoice, invoiceNumber: 'INV-001', job }, {
    createId: () => 'pdf-id', fileSystem, print: async () => ({ uri: 'file:///print.pdf' }),
  })
  expect(artifact.uri).toBe('file:///cache/fieldcraft-pdf/pdf-id.pdf')
  await artifact.cleanup()
  fileSystem.getInfoAsync.mockResolvedValueOnce({ exists: true, size: 11 * 1024 * 1024 })
  await expect(createInvoicePdf({ businessName: 'FieldCraft', client, invoice, invoiceNumber: 'INV-001', job }, { createId: () => 'large', fileSystem, print: async () => ({ uri: 'file:///large.pdf' }) })).rejects.toMatchObject({ code: 'PDF_TOO_LARGE' })
})
