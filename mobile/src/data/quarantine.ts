import type { EntityName, MutationKind } from '../domain/sync'

export const MAX_MUTATION_PAYLOAD_BYTES = 256 * 1024
export const MAX_RETAINED_MUTATIONS = 1_000
export const MAX_AUTOMATIC_ATTEMPTS = 8
export const DISCARD_QUARANTINE_CONFIRMATION = 'DISCARD UNSYNCED CHANGE' as const

export type QuarantineReason =
  | 'validation'
  | 'unsupported-schema'
  | 'integrity'
  | 'invalid-response'
  | 'attempt-limit'

export type QuarantinedMutation = {
  mutationId: string
  ownerId: string
  entity: EntityName
  entityId: string
  kind: MutationKind
  baseVersion: number | null
  payload: unknown
  payloadHash: string
  createdAt: string
  attempts: number
  reason: QuarantineReason
  quarantinedAt: string
  supersededBy?: string
  recoveryHistory: readonly {
    action: 'quarantined' | 'retried' | 'superseded'
    at: string
  }[]
}

export const utf8ByteLength = (value: string): number => {
  let bytes = 0
  for (const character of value) {
    const point = character.codePointAt(0)!
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4
  }
  return bytes
}
