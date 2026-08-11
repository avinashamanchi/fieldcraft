import { z } from 'zod'

import type { Client } from '../../domain/entities'
import type { MutationEnvelope } from '../../domain/sync'
import { codePointLength, literalSearch, recordMutation, type MutationBuildInput } from '../recordMutation'

const boundedText = (maximum: number, label: string) => z.string().trim().refine(
  (value) => codePointLength(value) <= maximum,
  `${label} must contain at most ${maximum} characters`,
)

export const ClientDraftSchema = z.object({
  name: boundedText(200, 'Name').pipe(z.string().min(1, 'Enter a client name')),
  phone: boundedText(64, 'Phone'),
  email: z.union([z.literal(''), z.email().max(320)]),
  address: boundedText(500, 'Address'),
  city: boundedText(100, 'City'),
  state: boundedText(100, 'State'),
  postalCode: boundedText(32, 'Postal code'),
  notes: boundedText(4000, 'Notes'),
}).strict()

export type ClientDraft = z.infer<typeof ClientDraftSchema>

export const buildClientMutation = (
  input: MutationBuildInput<Client> & { draft: ClientDraft },
): MutationEnvelope => {
  if (input.current && input.current.ownerId !== input.ownerId) throw new Error('Client owner changed')
  const draft = ClientDraftSchema.parse(input.draft)
  const payload: Client = {
    id: input.entityId,
    ownerId: input.ownerId,
    name: draft.name,
    ...(draft.phone ? { phone: draft.phone } : {}),
    ...(draft.email ? { email: draft.email } : {}),
    ...(draft.address ? { address: draft.address } : {}),
    ...(draft.city ? { city: draft.city } : {}),
    ...(draft.state ? { state: draft.state } : {}),
    ...(draft.postalCode ? { postalCode: draft.postalCode } : {}),
    ...(draft.notes ? { notes: draft.notes } : {}),
    version: input.current?.version ?? 1,
    createdAt: input.current?.createdAt ?? input.now,
    updatedAt: input.now,
    syncState: 'pending',
  }
  return recordMutation('client', input, payload)
}

export const filterClients = (clients: Client[], query: string): Client[] => clients.filter((client) => (
  literalSearch(client.name, query) || literalSearch(client.phone ?? '', query) || literalSearch(client.email ?? '', query)
))
