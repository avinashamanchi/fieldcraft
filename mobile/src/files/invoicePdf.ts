import * as Crypto from 'expo-crypto'
import * as FileSystem from 'expo-file-system/legacy'
import * as Print from 'expo-print'

import type { Client, Invoice, Job, Payment } from '../domain/entities'
import { calculateInvoice } from '../domain/invoice'
import { calculatePaymentSummary } from '../domain/payments'
import { tempArtifactRegistry } from './tempArtifactRegistry'

const MAX_PDF_BYTES = 10 * 1024 * 1024

export type InvoicePdfInput = {
  businessName: string
  client: Client
  invoice: Invoice
  invoiceNumber: string
  job: Job
  payments?: readonly Payment[]
  isPro?: boolean
}

export type PdfArtifact = { uri: string; cleanup(): Promise<void> }
export class InvoicePdfError extends Error {
  constructor(readonly code: 'CACHE_UNAVAILABLE' | 'INVALID_INVOICE' | 'PDF_FAILED' | 'PDF_TOO_LARGE') {
    super('The invoice PDF could not be created.')
    this.name = 'InvoicePdfError'
  }
}

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const money = (cents: number): string => `$${Math.floor(cents / 100).toLocaleString('en-US')}.${String(cents % 100).padStart(2, '0')}`
const quantity = (thousandths: number): string => (thousandths / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 })

export const buildInvoiceHtml = ({ businessName, client, invoice, invoiceNumber, job, payments = [], isPro = false }: InvoicePdfInput): string => {
  if (
    client.ownerId !== invoice.ownerId || job.ownerId !== invoice.ownerId ||
    client.id !== invoice.clientId || job.id !== invoice.jobId || job.clientId !== client.id ||
    payments.some((payment) => payment.ownerId !== invoice.ownerId || payment.invoiceId !== invoice.id)
  ) throw new InvoicePdfError('INVALID_INVOICE')
  const calculated = calculateInvoice(invoice.draft)
  if (calculated.subtotalCents !== invoice.subtotalCents || calculated.taxCents !== invoice.taxCents || calculated.totalCents !== invoice.totalCents) {
    throw new InvoicePdfError('INVALID_INVOICE')
  }
  const created = new Date(invoice.createdAt)
  if (Number.isNaN(created.getTime())) throw new InvoicePdfError('INVALID_INVOICE')
  const date = created.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  const rows = invoice.draft.lineItems.map((line) => {
    const lineTotal = Math.round(line.quantity * line.unitPriceCents / 1000)
    return `<tr><td>${escapeHtml(line.description)}</td><td>${escapeHtml(quantity(line.quantity))}</td><td>${money(line.unitPriceCents)}</td><td>${money(lineTotal)}</td></tr>`
  }).join('')
  const paymentSummary = calculatePaymentSummary(invoice.totalCents, payments.map((payment) => ({
    amountCents: payment.amountCents,
    currency: payment.currency,
    status: payment.status,
    refundedCents: payment.refundedCents,
  })))
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#1a1a1a;padding:36px}h1{font-size:30px;margin:0}.brand{color:#e55a1f;font-weight:800}.meta{display:flex;justify-content:space-between;margin:24px 0}.box{background:#f5f0eb;padding:16px}table{border-collapse:collapse;width:100%;margin:24px 0}th,td{border-bottom:1px solid #ddd;padding:10px;text-align:left}th:last-child,td:last-child{text-align:right}.totals{margin-left:auto;width:280px}.total{font-size:20px;font-weight:800}.balance{font-size:18px;font-weight:800}.note{white-space:pre-wrap}.footer{color:#666;margin-top:42px;text-align:center}
  </style></head><body>
    <div class="brand">FIELDCRAFT</div><h1>${escapeHtml(businessName || 'FieldCraft')}</h1>
    <div class="meta"><div><strong>Invoice ${escapeHtml(invoiceNumber)}</strong><br>${escapeHtml(date)}</div><div class="box"><strong>Client</strong><br>${escapeHtml(client.name)}<br><strong>Job</strong><br>${escapeHtml(job.title)}</div></div>
    <table><thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <table class="totals"><tr><td>Subtotal</td><td>${money(invoice.subtotalCents)}</td></tr><tr><td>Tax</td><td>${money(invoice.taxCents)}</td></tr><tr class="total"><td>Total</td><td>${money(invoice.totalCents)}</td></tr><tr><td>Paid</td><td>${money(paymentSummary.paidCents)}</td></tr><tr class="balance"><td>Balance</td><td>${money(paymentSummary.balanceCents)}</td></tr></table>
    <p><strong>Terms:</strong> ${escapeHtml(invoice.draft.paymentTerms)}</p>
    ${invoice.draft.notes ? `<p class="note"><strong>Notes:</strong><br>${escapeHtml(invoice.draft.notes)}</p>` : ''}
    ${isPro ? '' : '<p class="footer">Created with FieldCraft</p>'}
  </body></html>`
}

type PdfFileSystem = {
  cacheDirectory: string | null
  makeDirectoryAsync(uri: string, options: { intermediates: boolean }): Promise<void>
  moveAsync(options: { from: string; to: string }): Promise<void>
  getInfoAsync(uri: string): Promise<{ exists: boolean; size?: number }>
  deleteAsync(uri: string, options: { idempotent: boolean }): Promise<void>
}

export const createInvoicePdf = async (
  input: InvoicePdfInput,
  dependencies: {
    createId?: () => string
    fileSystem?: PdfFileSystem
    print?: (options: { html: string; base64: false }) => Promise<{ uri: string }>
  } = {},
): Promise<PdfArtifact> => {
  const fileSystem = dependencies.fileSystem ?? FileSystem
  if (!fileSystem.cacheDirectory) throw new InvoicePdfError('CACHE_UNAVAILABLE')
  const directory = `${fileSystem.cacheDirectory}fieldcraft-pdf`
  const uri = `${directory}/${(dependencies.createId ?? Crypto.randomUUID)()}.pdf`
  let printedUri: string | null = null
  const cleanup = async () => { await fileSystem.deleteAsync(uri, { idempotent: true }) }
  try {
    const html = buildInvoiceHtml(input)
    await fileSystem.makeDirectoryAsync(directory, { intermediates: true })
    const printed = await (dependencies.print ?? ((options) => Print.printToFileAsync(options)) )({ html, base64: false })
    printedUri = printed.uri
    await fileSystem.moveAsync({ from: printed.uri, to: uri })
    printedUri = null
    const info = await fileSystem.getInfoAsync(uri)
    if (!info.exists || !Number.isSafeInteger(info.size)) throw new InvoicePdfError('PDF_FAILED')
    if (Number(info.size) > MAX_PDF_BYTES) throw new InvoicePdfError('PDF_TOO_LARGE')
    tempArtifactRegistry.register(uri, cleanup)
    return { uri, cleanup: () => tempArtifactRegistry.delete(uri) }
  } catch (cause) {
    await cleanup().catch(() => {})
    if (printedUri) await fileSystem.deleteAsync(printedUri, { idempotent: true }).catch(() => {})
    if (cause instanceof InvoicePdfError) throw cause
    throw new InvoicePdfError('PDF_FAILED')
  }
}
