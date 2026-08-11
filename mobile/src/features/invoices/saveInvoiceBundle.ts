import * as Crypto from 'expo-crypto'

import type { Client, Invoice, InvoiceDraft, Job } from '../../domain/entities'
import { calculateInvoice } from '../../domain/invoice'
import type { MutationEnvelope } from '../../domain/sync'

type LocalMutationRepository = {
  transactLocalMutation(mutation: MutationEnvelope): Promise<void>
}

export type BundleIds = {
  clientId: string
  jobId: string
  invoiceId: string
  mutationId: string
}

export type InvoiceBundleSaveDependencies = {
  createId?: () => string
  existingClient?: Client
  existingJob?: Job
  now?: () => string
  ownerId: string
  repository: LocalMutationRepository
}

const normalizedName = (value: string): string => value
  .trim()
  .normalize('NFKD')
  .replace(/\p{M}/gu, '')
  .toLocaleLowerCase()

export const matchClientByName = (clients: Client[], clientName: string): Client | undefined => {
  const target = normalizedName(clientName)
  if (!target) return undefined
  return clients.find((client) => normalizedName(client.name) === target)
}

export type InvoiceBundleSaveOperation = {
  ids: BundleIds
  mutation: MutationEnvelope
  save(): Promise<BundleIds>
}

export const createInvoiceBundleSaveOperation = (
  inputDraft: InvoiceDraft,
  dependencies: InvoiceBundleSaveDependencies,
): InvoiceBundleSaveOperation => {
  const calculated = calculateInvoice(inputDraft)
  const draft: InvoiceDraft = {
    ...inputDraft,
    clientName: inputDraft.clientName.trim(),
    jobTitle: inputDraft.jobTitle.trim(),
    lineItems: inputDraft.lineItems.map((line) => ({ ...line })),
  }
  const createId = dependencies.createId ?? Crypto.randomUUID
  const timestamp = (dependencies.now ?? (() => new Date().toISOString()))()
  if (dependencies.existingClient?.ownerId !== undefined && dependencies.existingClient.ownerId !== dependencies.ownerId) {
    throw new Error('Existing client does not belong to the active owner.')
  }
  if (
    dependencies.existingJob && (
      dependencies.existingJob.ownerId !== dependencies.ownerId ||
      dependencies.existingClient === undefined ||
      dependencies.existingJob.clientId !== dependencies.existingClient.id
    )
  ) throw new Error('Existing job does not belong to the active owner and client.')
  const ids: BundleIds = {
    clientId: dependencies.existingClient?.id ?? createId(),
    jobId: dependencies.existingJob?.id ?? createId(),
    invoiceId: createId(),
    mutationId: createId(),
  }
  const client: Client = dependencies.existingClient
    ? { ...dependencies.existingClient, syncState: 'pending', updatedAt: timestamp }
    : {
        id: ids.clientId, ownerId: dependencies.ownerId, name: draft.clientName,
        version: 1, createdAt: timestamp, updatedAt: timestamp, syncState: 'pending',
      }
  const job: Job = dependencies.existingJob
    ? {
        ...dependencies.existingJob,
        title: draft.jobTitle, status: 'Invoiced', tradeType: draft.tradeType,
        address: draft.jobAddress, description: draft.jobDescription, notes: draft.notes,
        updatedAt: timestamp, syncState: 'pending',
      }
    : {
        id: ids.jobId, ownerId: dependencies.ownerId, clientId: ids.clientId,
        title: draft.jobTitle, status: 'Invoiced', tradeType: draft.tradeType,
        address: draft.jobAddress, description: draft.jobDescription, notes: draft.notes,
        version: 1, createdAt: timestamp, updatedAt: timestamp, syncState: 'pending',
      }
  const invoice: Invoice = {
    id: ids.invoiceId, ownerId: dependencies.ownerId, clientId: ids.clientId, jobId: ids.jobId,
    draft, subtotalCents: calculated.subtotalCents, taxCents: calculated.taxCents,
    totalCents: calculated.totalCents,
    version: 1, createdAt: timestamp, updatedAt: timestamp, syncState: 'pending',
  }
  const mutation: MutationEnvelope = {
    id: ids.mutationId, ownerId: dependencies.ownerId, entity: 'invoice', entityId: ids.invoiceId,
    kind: 'save_invoice_bundle', baseVersion: null, payload: { client, job, invoice },
    createdAt: timestamp, attempts: 0,
  }
  return {
    ids,
    mutation,
    async save() {
      await dependencies.repository.transactLocalMutation(mutation)
      return ids
    },
  }
}

export const saveInvoiceBundle = async (
  draft: InvoiceDraft,
  dependencies: InvoiceBundleSaveDependencies,
): Promise<BundleIds> => createInvoiceBundleSaveOperation(draft, dependencies).save()

const dueAtForTerms = (issuedAt: string, terms: InvoiceDraft['paymentTerms']): string => {
  const issued = Date.parse(issuedAt)
  if (!Number.isFinite(issued)) throw new Error('INVALID_INVOICE_TIMESTAMP')
  const days = terms === 'Net 30' ? 30 : terms === 'Net 14' ? 14 : 0
  return new Date(issued + days * 24 * 60 * 60 * 1_000).toISOString()
}

export const buildIssueInvoiceMutation = (input: Readonly<{
  invoice: Invoice
  mutationId: string
  issuedAt: string
}>): MutationEnvelope => {
  if ((input.invoice.status ?? 'Draft') !== 'Draft') throw new Error('INVALID_INVOICE_TRANSITION')
  const dueAt = dueAtForTerms(input.issuedAt, input.invoice.draft.paymentTerms)
  const invoice: Invoice = {
    ...input.invoice,
    number: input.invoice.number ?? `INV-${input.invoice.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
    status: 'Issued',
    issuedAt: input.issuedAt,
    dueAt,
    version: input.invoice.version + 1,
    updatedAt: input.issuedAt,
    syncState: 'pending',
  }
  return {
    id: input.mutationId,
    ownerId: input.invoice.ownerId,
    entity: 'invoice',
    entityId: input.invoice.id,
    kind: 'issue_invoice',
    baseVersion: input.invoice.version,
    payload: {
      invoiceId: input.invoice.id,
      baseVersion: input.invoice.version,
      issuedAt: input.issuedAt,
      dueAt,
      invoice,
    },
    createdAt: input.issuedAt,
    attempts: 0,
  }
}
