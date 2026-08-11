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
  const ids: BundleIds = {
    clientId: dependencies.existingClient?.id ?? createId(),
    jobId: createId(),
    invoiceId: createId(),
    mutationId: createId(),
  }
  const client: Client = dependencies.existingClient
    ? { ...dependencies.existingClient, syncState: 'pending', updatedAt: timestamp }
    : {
        id: ids.clientId, ownerId: dependencies.ownerId, name: draft.clientName,
        version: 1, createdAt: timestamp, updatedAt: timestamp, syncState: 'pending',
      }
  const job: Job = {
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
