import * as Crypto from 'expo-crypto'

import type { ConflictRecord, MutationEnvelope } from '../domain/sync'
import type { MutationOutbox } from './outbox'
import type { CloudRowEnvelope, InvoiceBundlePayload, MutationFailureReason } from './repository'
import {
  RemoteGatewayError,
  type RemoteFailureReason,
  type RemoteGateway,
  type RealtimeSubscription,
} from './remoteGateway'

export { RemoteGatewayError } from './remoteGateway'

export type SyncStatus =
  | { state: 'offline'; pending: number }
  | { state: 'current'; lastSyncedAt: string }
  | { state: 'syncing'; pending: number }
  | { state: 'failed'; pending: number; retryAt: string }
  | { state: 'conflict'; count: number }

export type DurableMutationFailure = MutationFailureReason

export interface SyncRepository {
  outbox: MutationOutbox
  getSyncCursor(ownerId: string): Promise<string | null>
  commitPull(
    ownerId: string,
    rows: CloudRowEnvelope[],
    cursor: string,
    markInitialHydration?: boolean,
    isCurrent?: () => boolean,
  ): Promise<void>
  acknowledgeMutation(
    ownerId: string,
    mutationId: string,
    rows: CloudRowEnvelope[],
    isCurrent?: () => boolean,
    requiresBootstrapRepair?: boolean,
  ): Promise<void>
  recordMutationFailure(
    ownerId: string,
    mutationId: string,
    reason: DurableMutationFailure,
    isCurrent?: () => boolean,
  ): Promise<void>
  recordMutationConflict(
    ownerId: string,
    conflict: ConflictRecord,
    isCurrent?: () => boolean,
  ): Promise<void>
  countConflicts(ownerId: string): Promise<number>
}

export interface ConflictResolutionRepository {
  getConflict(mutationId: string): Promise<ConflictRecord | null>
  resolveConflictKeepCloud(mutationId: string): Promise<void>
  resolveConflictWithMutation(
    originalMutationId: string,
    replacement: MutationEnvelope,
  ): Promise<void>
}

export interface SyncClock {
  now(): number
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export type SyncLifecycle = {
  ownerId: string | null
  authenticated: boolean
  foreground: boolean
  online: boolean
}

type SyncCoordinatorOptions = {
  repository: SyncRepository
  gateway: RemoteGateway
  refreshAuthentication(ownerId: string, signal: AbortSignal): Promise<void>
  clock?: SyncClock
  random?: () => number
  onReauthenticationRequired?: (ownerId: string) => void
}

const systemClock: SyncClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

const MIN_RETRY_DELAY_MS = 5_000
const MAX_RETRY_DELAY_MS = 300_000

export const computeRetryDelayMs = (attempt: number, random: number): number => {
  const safeAttempt = Math.max(0, Math.min(30, Math.floor(attempt)))
  const safeRandom = Math.max(0, Math.min(1, random))
  const exponential = MIN_RETRY_DELAY_MS * 2 ** safeAttempt
  const jittered = exponential * (0.5 + safeRandom)
  return Math.max(MIN_RETRY_DELAY_MS, Math.min(MAX_RETRY_DELAY_MS, Math.round(jittered)))
}

const lifecycleEquals = (left: SyncLifecycle, right: SyncLifecycle): boolean =>
  left.ownerId === right.ownerId &&
  left.authenticated === right.authenticated &&
  left.foreground === right.foreground &&
  left.online === right.online

const isEligible = (lifecycle: SyncLifecycle): lifecycle is SyncLifecycle & { ownerId: string } =>
  lifecycle.ownerId !== null &&
  lifecycle.authenticated &&
  lifecycle.foreground &&
  lifecycle.online

const classifyFailure = (error: unknown): RemoteFailureReason =>
  error instanceof RemoteGatewayError ? error.reason : 'transient'

export class SyncCoordinator {
  private readonly repository: SyncRepository
  private readonly gateway: RemoteGateway
  private readonly refreshAuthentication: SyncCoordinatorOptions['refreshAuthentication']
  private readonly clock: SyncClock
  private readonly random: () => number
  private readonly onReauthenticationRequired: (ownerId: string) => void
  private lifecycle: SyncLifecycle = {
    ownerId: null,
    authenticated: false,
    foreground: false,
    online: false,
  }
  private status: SyncStatus = { state: 'offline', pending: 0 }
  private readonly listeners = new Set<() => void>()
  private generation = 0
  private running: { generation: number; promise: Promise<void>; controller: AbortController } | null = null
  private realtime: RealtimeSubscription | null = null
  private retryTimer: unknown = null
  private realtimeRetryTimer: unknown = null
  private followUpRequested = false
  private readonly retryAttempts = { authentication: 0, pull: 0, push: 0, realtime: 0 }
  private disposed = false

  constructor(options: SyncCoordinatorOptions) {
    this.repository = options.repository
    this.gateway = options.gateway
    this.refreshAuthentication = options.refreshAuthentication
    this.clock = options.clock ?? systemClock
    this.random = options.random ?? Math.random
    this.onReauthenticationRequired = options.onReauthenticationRequired ?? (() => {})
  }

  readonly getStatus = (): SyncStatus => this.status

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async setLifecycle(next: SyncLifecycle): Promise<void> {
    if (this.disposed) return
    if (lifecycleEquals(this.lifecycle, next)) {
      if (isEligible(next)) await this.trigger()
      return
    }

    this.generation += 1
    this.lifecycle = next
    this.cancelGenerationWork()
    this.resetRetryAttempts()

    if (!isEligible(next)) {
      const pending = await this.readPendingCount(next.ownerId, this.generation)
      if (this.isGenerationCurrent(this.generation)) {
        this.setStatus({ state: 'offline', pending })
      }
      return
    }

    this.ensureRealtime(next.ownerId, this.generation)
    await this.trigger()
  }

  trigger(guaranteeFollowUp = false): Promise<void> {
    if (this.disposed || !isEligible(this.lifecycle)) return Promise.resolve()
    const requestedGeneration = this.generation
    const running = this.running
    if (running) {
      if (running.generation === requestedGeneration) {
        if (guaranteeFollowUp) this.followUpRequested = true
        return running.promise
      }
    }

    this.clearSyncRetry()
    const ownerId = this.lifecycle.ownerId
    const controller = new AbortController()
    const promise = this.runGeneration(requestedGeneration, ownerId, controller.signal)
      .catch(async () => {
        if (!this.isRunCurrent(requestedGeneration, ownerId, controller.signal)) {
          return
        }
        const pending = await this.readPendingCount(ownerId, requestedGeneration)
        if (this.isRunCurrent(requestedGeneration, ownerId, controller.signal)) {
          this.failStatus(pending, 'transient', requestedGeneration, 'pull')
        }
      })
      .finally(() => {
        if (this.running?.promise !== promise) return
        this.running = null
        if (
          this.followUpRequested &&
          this.isGenerationCurrent(requestedGeneration) &&
          isEligible(this.lifecycle)
        ) {
          this.followUpRequested = false
          void this.trigger()
        }
      })
    this.running = { generation: requestedGeneration, promise, controller }
    return promise
  }

  async notifyLocalMutation(): Promise<void> {
    if (this.disposed || this.lifecycle.ownerId === null) return
    const generation = this.generation
    const ownerId = this.lifecycle.ownerId
    const pending = await this.readPendingCount(ownerId, generation)
    if (!this.isGenerationCurrent(generation)) return
    if (!isEligible(this.lifecycle)) {
      this.setStatus({ state: 'offline', pending })
      return
    }
    this.setStatus({ state: 'syncing', pending })
    await this.trigger(true)
  }

  async whenIdle(): Promise<void> {
    while (this.running) await this.running.promise
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    this.cancelGenerationWork()
    this.listeners.clear()
  }

  private async runGeneration(
    generation: number,
    ownerId: string,
    signal: AbortSignal,
  ): Promise<void> {
    let pending = await this.repository.outbox.list(ownerId)
    if (!this.isRunCurrent(generation, ownerId, signal)) return
    this.setStatus({ state: 'syncing', pending: pending.length })

    try {
      await this.refreshAuthentication(ownerId, signal)
      this.retryAttempts.authentication = 0
    } catch (error) {
      if (!this.isRunCurrent(generation, ownerId, signal)) return
      const reason = classifyFailure(error)
      if (reason === 'reauthentication') this.onReauthenticationRequired(ownerId)
      this.failStatus(pending.length, reason, generation, 'authentication')
      return
    }
    if (!this.isRunCurrent(generation, ownerId, signal)) return

    try {
      const cursor = await this.repository.getSyncCursor(ownerId)
      if (!this.isRunCurrent(generation, ownerId, signal)) return
      const pull = await this.gateway.pullSince(ownerId, cursor, signal)
      if (!this.isRunCurrent(generation, ownerId, signal)) return
      await this.repository.commitPull(
        ownerId,
        pull.rows,
        pull.cursor,
        !pull.hasMore,
        () => this.isRunCurrent(generation, ownerId, signal),
      )
      this.retryAttempts.pull = 0
      if (pull.hasMore) {
        this.followUpRequested = true
        return
      }
    } catch (error) {
      if (!this.isRunCurrent(generation, ownerId, signal)) return
      const reason = classifyFailure(error)
      if (reason === 'reauthentication') this.onReauthenticationRequired(ownerId)
      this.failStatus(pending.length, reason, generation, 'pull')
      return
    }
    if (!this.isRunCurrent(generation, ownerId, signal)) return

    pending = await this.repository.outbox.list(ownerId)
    if (!this.isRunCurrent(generation, ownerId, signal)) return
    this.setStatus({ state: 'syncing', pending: pending.length })

    for (const [index, item] of pending.entries()) {
      if (!this.isRunCurrent(generation, ownerId, signal)) return
      if (item.failureReason === 'validation' || item.failureReason === 'invalid-response') {
        this.failStatus(pending.length - index, item.failureReason, generation, 'push')
        return
      }
      let result
      try {
        result = await this.gateway.pushMutation(ownerId, item, signal)
      } catch (error) {
        if (!this.isRunCurrent(generation, ownerId, signal)) return
        const reason = classifyFailure(error)
        await this.repository.recordMutationFailure(
          ownerId,
          item.id,
          reason,
          () => this.isRunCurrent(generation, ownerId, signal),
        )
        if (!this.isRunCurrent(generation, ownerId, signal)) return
        if (reason === 'reauthentication') this.onReauthenticationRequired(ownerId)
        this.failStatus(pending.length, reason, generation, 'push')
        return
      }
      if (!this.isRunCurrent(generation, ownerId, signal)) return

      if (result.type === 'conflict') {
        await this.repository.recordMutationConflict(
          ownerId,
          result.conflict,
          () => this.isRunCurrent(generation, ownerId, signal),
        )
        if (!this.isRunCurrent(generation, ownerId, signal)) return
        this.retryAttempts.push = 0
        this.setStatus({ state: 'conflict', count: await this.repository.countConflicts(ownerId) })
        return
      }

      try {
        await this.repository.acknowledgeMutation(
          ownerId,
          item.id,
          result.rows,
          () => this.isRunCurrent(generation, ownerId, signal),
          result.requiresBootstrapRepair === true,
        )
        this.retryAttempts.push = 0
      } catch {
        if (!this.isRunCurrent(generation, ownerId, signal)) return
        try {
          await this.repository.recordMutationFailure(
            ownerId,
            item.id,
            'transient',
            () => this.isRunCurrent(generation, ownerId, signal),
          )
        } catch {
          // The original outbox row remains sendable when local failure recording also fails.
        }
        if (!this.isRunCurrent(generation, ownerId, signal)) return
        this.failStatus(pending.length, 'transient', generation, 'push')
        return
      }
    }

    if (!this.isRunCurrent(generation, ownerId, signal)) return
    const conflicts = await this.repository.countConflicts(ownerId)
    if (!this.isRunCurrent(generation, ownerId, signal)) return
    if (conflicts > 0) {
      this.setStatus({ state: 'conflict', count: conflicts })
      return
    }
    if (this.followUpRequested) {
      this.setStatus({ state: 'syncing', pending: 0 })
      return
    }
    this.setStatus({ state: 'current', lastSyncedAt: new Date(this.clock.now()).toISOString() })
  }

  private failStatus(
    pending: number,
    reason: RemoteFailureReason,
    generation: number,
    operation: 'authentication' | 'pull' | 'push',
  ): void {
    const attempts = this.retryAttempts[operation]
    this.retryAttempts[operation] += 1
    const delay = reason === 'transient'
      ? computeRetryDelayMs(attempts, this.random())
      : 0
    this.setStatus({
      state: 'failed',
      pending,
      retryAt: new Date(this.clock.now() + delay).toISOString(),
    })
    if (reason !== 'transient' || !this.isGenerationCurrent(generation)) return
    this.retryTimer = this.clock.setTimeout(() => {
      this.retryTimer = null
      if (this.isGenerationCurrent(generation)) void this.trigger()
    }, delay)
  }

  private async readPendingCount(ownerId: string | null, generation: number): Promise<number> {
    if (!ownerId) return 0
    try {
      const pending = await this.repository.outbox.list(ownerId)
      return this.isGenerationCurrent(generation) ? pending.length : 0
    } catch {
      return 0
    }
  }

  private ensureRealtime(ownerId: string, generation: number): void {
    if (this.realtime || !this.isGenerationCurrent(generation)) return
    try {
      this.realtime = this.gateway.subscribeToOwner(
        ownerId,
        () => {
          if (this.isGenerationCurrent(generation)) {
            this.retryAttempts.realtime = 0
            void this.trigger(true)
          }
        },
        () => {
          if (!this.isGenerationCurrent(generation)) return
          this.realtime?.unsubscribe()
          this.realtime = null
          this.followUpRequested = true
          void this.trigger(true)
          this.scheduleRealtimeRetry(ownerId, generation)
        },
      )
    } catch {
      this.scheduleRealtimeRetry(ownerId, generation)
    }
  }

  private scheduleRealtimeRetry(ownerId: string, generation: number): void {
    if (this.realtimeRetryTimer !== null || !this.isGenerationCurrent(generation)) return
    const delay = computeRetryDelayMs(this.retryAttempts.realtime, this.random())
    this.retryAttempts.realtime += 1
    this.realtimeRetryTimer = this.clock.setTimeout(() => {
      this.realtimeRetryTimer = null
      if (this.isGenerationCurrent(generation) && isEligible(this.lifecycle)) {
        this.ensureRealtime(ownerId, generation)
      }
    }, delay)
  }

  private cancelGenerationWork(): void {
    this.running?.controller.abort()
    this.running = null
    this.followUpRequested = false
    this.realtime?.unsubscribe()
    this.realtime = null
    this.clearSyncRetry()
    if (this.realtimeRetryTimer !== null) {
      this.clock.clearTimeout(this.realtimeRetryTimer)
      this.realtimeRetryTimer = null
    }
  }

  private clearSyncRetry(): void {
    if (this.retryTimer === null) return
    this.clock.clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private resetRetryAttempts(): void {
    this.retryAttempts.authentication = 0
    this.retryAttempts.pull = 0
    this.retryAttempts.push = 0
    this.retryAttempts.realtime = 0
  }

  private isGenerationCurrent(generation: number): boolean {
    return !this.disposed && generation === this.generation
  }

  private isRunCurrent(generation: number, ownerId: string, signal: AbortSignal): boolean {
    return this.isGenerationCurrent(generation) &&
      !signal.aborted &&
      isEligible(this.lifecycle) &&
      this.lifecycle.ownerId === ownerId
  }

  private setStatus(status: SyncStatus): void {
    this.status = status
    for (const listener of this.listeners) listener()
  }
}

type ConflictCommandOptions = {
  createMutationId?: () => string
  now?: () => string
}

export type ConflictResolutionCommands = {
  getConflict(mutationId: string): Promise<ConflictRecord | null>
  keepCloud(mutationId: string): Promise<void>
  applyMyEdit(mutationId: string): Promise<void>
}

export const createConflictResolutionCommands = (
  repository: ConflictResolutionRepository,
  options: ConflictCommandOptions = {},
): ConflictResolutionCommands => ({
  getConflict: (mutationId) => repository.getConflict(mutationId),
  keepCloud: (mutationId) => repository.resolveConflictKeepCloud(mutationId),
  async applyMyEdit(mutationId) {
    const conflict = await repository.getConflict(mutationId)
    if (!conflict) throw new Error('The conflict is no longer available.')
    const isDelete = conflict.mutationKind === 'delete'
    const isBundle = conflict.mutationKind === 'save_invoice_bundle'
    const isRemoteDeletion = !isDelete && !isBundle && conflict.cloudPayload === null
    if (!isDelete && (
      typeof conflict.localPayload !== 'object' ||
      conflict.localPayload === null ||
      Array.isArray(conflict.localPayload)
    )) {
      throw new Error('The conflict cannot be resolved safely.')
    }
    const localPayload = isDelete ? null : conflict.localPayload as Record<string, unknown>
    const cloudPayload = conflict.cloudPayload as Record<string, unknown> | null
    if (isDelete && cloudPayload === null) {
      await repository.resolveConflictKeepCloud(mutationId)
      return
    }
    const ownerId = isBundle
      ? (conflict.localPayload as InvoiceBundlePayload).client.ownerId
      : isDelete ? cloudPayload?.ownerId ?? conflict.ownerId : localPayload?.ownerId ?? conflict.ownerId
    if (typeof ownerId !== 'string' || ownerId.length === 0) {
      throw new Error('The conflict cannot be resolved safely.')
    }
    const now = options.now?.() ?? new Date().toISOString()
    const replacementId = options.createMutationId?.() ?? Crypto.randomUUID()
    if (replacementId === conflict.mutationId) {
      throw new Error('A conflict retry requires a new mutation ID.')
    }
    await repository.resolveConflictWithMutation(conflict.mutationId, {
      id: replacementId,
      ownerId,
      entity: conflict.entity,
      entityId: conflict.entityId,
      kind: isBundle
        ? 'save_invoice_bundle'
        : isDelete ? 'delete' : isRemoteDeletion ? 'create' : 'update',
      baseVersion: isRemoteDeletion ? null : conflict.cloudVersion,
      payload: isDelete
        ? null
        : isBundle
          ? Object.fromEntries((['client', 'job', 'invoice'] as const).map((entity) => {
              const local = (conflict.localPayload as InvoiceBundlePayload)[entity]
              const cloud = (conflict.cloudPayload as {
                client: InvoiceBundlePayload['client'] | null
                job: InvoiceBundlePayload['job'] | null
                invoice: InvoiceBundlePayload['invoice'] | null
              })[entity]
              return [entity, {
                ...local,
                version: cloud?.version ?? 0,
                updatedAt: now,
                syncState: 'pending',
              }]
            }))
        : {
            ...localPayload,
            version: isRemoteDeletion ? 0 : conflict.cloudVersion,
            updatedAt: now,
            syncState: 'pending',
          },
      createdAt: now,
      attempts: 0,
    })
  },
})
