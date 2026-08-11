import type { ConflictRecord, MutationEnvelope } from '../domain/sync'
import type { CloudRowEnvelope } from './repository'

export type PullResult =
  | {
      type?: 'page'
      rows: CloudRowEnvelope[]
      cursor: string
      hasMore: boolean
    }
  | {
      type: 'cursorExpired'
      snapshotWatermark: number
      snapshotCursor: string | null
      rows: []
      cursor: string
      hasMore: false
    }

export type SnapshotPullResult = {
  rows: CloudRowEnvelope[]
  cursor: string | null
  hasMore: boolean
  snapshotWatermark: number
  resumeCursor: string
}

export type PushResult =
  | {
      type: 'applied'
      rows: CloudRowEnvelope[]
      requiresBootstrapRepair?: true
    }
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
  pullSnapshot?(
    ownerId: string,
    watermark: number,
    cursor: string | null,
    signal: AbortSignal,
  ): Promise<SnapshotPullResult>
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
