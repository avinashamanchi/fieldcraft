import * as Crypto from 'expo-crypto'

import type { ConflictRecord, MutationEnvelope } from '../domain/sync'
import type { MutationOutbox } from './outbox'
import type { CloudRowEnvelope, MutationFailureReason } from './repository'
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
    isCurrent?: () => boolean,
  ): Promise<void>
  acknowledgeMutation(
    ownerId: string,
    mutationId: string,
    rows: CloudRowEnvelope[],
    isCurrent?: () => boolean,
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

  trigger(): Promise<void> {
    if (this.disposed || !isEligible(this.lifecycle)) return Promise.resolve()
    const requestedGeneration = this.generation
    const running = this.running
    if (running) {
      if (running.generation === requestedGeneration) return running.promise
      return running.promise.then(() => {
        if (!this.isGenerationCurrent(requestedGeneration) || !isEligible(this.lifecycle)) return
        return this.trigger()
      })
    }

    this.clearRetry()
    const ownerId = this.lifecycle.ownerId
    const controller = new AbortController()
    const promise = this.runGeneration(requestedGeneration, ownerId, controller.signal)
      .catch(async () => {
        if (!this.isRunCurrent(requestedGeneration, ownerId, controller.signal)) {
          return
        }
        const pending = await this.readPendingCount(ownerId, requestedGeneration)
        if (this.isRunCurrent(requestedGeneration, ownerId, controller.signal)) {
          this.failStatus(pending, 'transient', requestedGeneration)
        }
      })
      .finally(() => {
        if (this.running?.promise === promise) this.running = null
      })
    this.running = { generation: requestedGeneration, promise, controller }
    return promise
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
    } catch (error) {
      if (!this.isRunCurrent(generation, ownerId, signal)) return
      const reason = classifyFailure(error)
      if (reason === 'reauthentication') this.onReauthenticationRequired(ownerId)
      this.failStatus(pending.length, reason, generation)
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
        () => this.isRunCurrent(generation, ownerId, signal),
      )
    } catch (error) {
      if (!this.isRunCurrent(generation, ownerId, signal)) return
      this.failStatus(pending.length, classifyFailure(error), generation)
      return
    }
    if (!this.isRunCurrent(generation, ownerId, signal)) return

    pending = await this.repository.outbox.list(ownerId)
    if (!this.isRunCurrent(generation, ownerId, signal)) return
    this.setStatus({ state: 'syncing', pending: pending.length })

    for (const item of pending) {
      if (!this.isRunCurrent(generation, ownerId, signal)) return
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
        this.failStatus(pending.length, reason, generation, item.attempts)
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
        this.setStatus({ state: 'conflict', count: await this.repository.countConflicts(ownerId) })
        return
      }

      try {
        await this.repository.acknowledgeMutation(
          ownerId,
          item.id,
          result.rows,
          () => this.isRunCurrent(generation, ownerId, signal),
        )
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
        this.failStatus(pending.length, 'transient', generation, item.attempts)
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
    this.setStatus({ state: 'current', lastSyncedAt: new Date(this.clock.now()).toISOString() })
  }

  private failStatus(
    pending: number,
    reason: RemoteFailureReason,
    generation: number,
    attempts = 0,
  ): void {
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
    this.realtime = this.gateway.subscribeToOwner(
      ownerId,
      () => {
        if (this.isGenerationCurrent(generation)) void this.trigger()
      },
      () => {
        if (this.isGenerationCurrent(generation)) {
          this.realtime?.unsubscribe()
          this.realtime = null
          void this.trigger()
        }
      },
    )
  }

  private cancelGenerationWork(): void {
    this.running?.controller.abort()
    this.realtime?.unsubscribe()
    this.realtime = null
    this.clearRetry()
  }

  private clearRetry(): void {
    if (this.retryTimer === null) return
    this.clock.clearTimeout(this.retryTimer)
    this.retryTimer = null
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
    if (!isDelete && (
      typeof conflict.localPayload !== 'object' ||
      conflict.localPayload === null ||
      Array.isArray(conflict.localPayload)
    )) {
      throw new Error('The conflict cannot be resolved safely.')
    }
    const localPayload = isDelete ? null : conflict.localPayload as Record<string, unknown>
    const cloudPayload = conflict.cloudPayload as Record<string, unknown> | null
    const ownerId = isDelete ? cloudPayload?.ownerId : localPayload?.ownerId
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
      kind: isDelete ? 'delete' : 'update',
      baseVersion: conflict.cloudVersion,
      payload: isDelete
        ? null
        : {
            ...localPayload,
            version: conflict.cloudVersion,
            updatedAt: now,
            syncState: 'pending',
          },
      createdAt: now,
      attempts: 0,
    })
  },
})
