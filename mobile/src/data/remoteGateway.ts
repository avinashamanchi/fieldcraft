import type { ConflictRecord, MutationEnvelope } from '../domain/sync'
import type { CloudRowEnvelope } from './repository'

export type PullResult = {
  rows: CloudRowEnvelope[]
  cursor: string
  hasMore: boolean
}

export type PushResult =
  | { type: 'applied'; rows: CloudRowEnvelope[] }
  | { type: 'conflict'; conflict: ConflictRecord }

export type RemoteFailureReason =
  | 'transient'
  | 'reauthentication'
  | 'validation'
  | 'invalid-response'

export class RemoteGatewayError extends Error {
  constructor(readonly reason: RemoteFailureReason) {
    super('The synchronization service could not complete the request.')
    this.name = 'RemoteGatewayError'
  }
}

export type RealtimeSubscription = {
  unsubscribe(): void
}

export interface RemoteGateway {
  pullSince(ownerId: string, cursor: string | null, signal: AbortSignal): Promise<PullResult>
  pushMutation(
    ownerId: string,
    mutation: MutationEnvelope,
    signal: AbortSignal,
  ): Promise<PushResult>
  subscribeToOwner(
    ownerId: string,
    onInvalidation: () => void,
    onFailure?: () => void,
  ): RealtimeSubscription
}
