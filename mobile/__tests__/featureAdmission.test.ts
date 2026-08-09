import type { AuthenticatedOwnerLease } from '../src/auth/AuthProvider'
import {
  AdmissionControlledFieldCraftRepository,
  FeatureAdmissionService,
} from '../src/billing/featureAdmission'
import { EntitlementStore } from '../src/billing/entitlementStore'
import { SQLiteFieldCraftRepository } from '../src/data/sqliteRepository'
import type { MutationEnvelope } from '../src/domain/sync'
import type { FeatureCounts, ProEntitlement } from '../src/domain/monetization'

const lease = (ownerId: string, generation = 1): AuthenticatedOwnerLease => Object.freeze({
  ownerId,
  sessionGeneration: generation,
  repositoryRevision: 1,
})
const counts: FeatureCounts = {
  clients: 10,
  openJobs: 0,
  issuedDocumentsPerRolling30Days: 0,
}
const pro: ProEntitlement = { state: 'pro', productId: 'fieldcraft_pro_monthly', expiresAt: '2026-09-01T00:00:00.000Z' }
const mutationId = '80000000-0000-4000-8000-000000000001'

describe('FeatureAdmissionService', () => {
  it('reserves exactly once for concurrent above-free creation and binds the echoed receipt', async () => {
    let calls = 0
    const service = new FeatureAdmissionService({
      reserve: async (expectedLease, expectedMutation, feature) => {
        calls += 1
        return {
          ownerId: expectedLease.ownerId,
          mutationId: expectedMutation,
          feature,
          decision: { allowed: true },
        }
      },
      currentLease: () => lease('70000000-0000-4000-8000-000000000001'),
      currentEntitlement: () => pro,
    })

    const [first, second] = await Promise.all([
      service.admit(mutationId, 'create-client', counts),
      service.admit(mutationId, 'create-client', counts),
    ])
    expect(first).toEqual({ allowed: true })
    expect(second).toEqual({ allowed: true })
    expect(calls).toBe(1)
  })

  it('returns stale and queues no admission for unknown, offline, malformed, or owner-switched state', async () => {
    let activeLease = lease('70000000-0000-4000-8000-000000000001')
    let entitlement: ProEntitlement = { state: 'unknown', reason: 'verifying' }
    let calls = 0
    const service = new FeatureAdmissionService({
      reserve: async (expectedLease, expectedMutation, feature) => {
        calls += 1
        activeLease = lease('70000000-0000-4000-8000-000000000002', 2)
        return { ownerId: expectedLease.ownerId, mutationId: expectedMutation, feature, decision: { allowed: true } }
      },
      currentLease: () => activeLease,
      currentEntitlement: () => entitlement,
    })

    await expect(service.admit(mutationId, 'create-client', counts)).resolves.toEqual({
      allowed: false,
      reason: 'ENTITLEMENT_STALE',
    })
    expect(calls).toBe(0)

    entitlement = pro
    await expect(service.admit('not-a-uuid', 'create-client', counts)).resolves.toEqual({
      allowed: false,
      reason: 'ENTITLEMENT_STALE',
    })
    expect(calls).toBe(0)

    await expect(service.admit(mutationId, 'create-client', counts)).resolves.toEqual({
      allowed: false,
      reason: 'ENTITLEMENT_STALE',
    })
    expect(calls).toBe(1)
  })

  it('keeps below-limit and downgrade-safe work local and fail-closes provider failures', async () => {
    let calls = 0
    const service = new FeatureAdmissionService({
      reserve: async () => { calls += 1; throw new Error('offline private detail') },
      currentLease: () => lease('70000000-0000-4000-8000-000000000001'),
      currentEntitlement: () => pro,
    })
    await expect(service.admit(mutationId, 'create-client', { ...counts, clients: 9 })).resolves.toEqual({ allowed: true })
    await expect(service.admit(mutationId, 'export-account', counts)).resolves.toEqual({ allowed: true })
    expect(calls).toBe(0)
    await expect(service.admit(mutationId, 'create-client', counts)).resolves.toEqual({
      allowed: false,
      reason: 'ENTITLEMENT_STALE',
    })
  })

  it('treats invalid counters as above-limit and requires an online admission', async () => {
    let calls = 0
    const service = new FeatureAdmissionService({
      reserve: async (expectedLease, expectedMutation, feature) => {
        calls += 1
        return {
          ownerId: expectedLease.ownerId,
          mutationId: expectedMutation,
          feature,
          decision: { allowed: true },
        }
      },
      currentLease: () => lease('70000000-0000-4000-8000-000000000001'),
      currentEntitlement: () => pro,
    })

    await expect(service.admit(mutationId, 'create-client', {
      ...counts,
      clients: Number.NaN,
    })).resolves.toEqual({ allowed: true })
    expect(calls).toBe(1)
  })

  it('reserves above-free creation before the SQLite transaction starts', async () => {
    const activeLease = lease('70000000-0000-4000-8000-000000000001')
    const store = new EntitlementStore(() => Date.parse('2026-08-09T00:00:00.000Z'))
    store.bind(activeLease)
    store.publish(activeLease, pro)
    let release!: () => void
    const reservation = new Promise<void>((resolve) => { release = resolve })
    const reserve = jest.fn(async () => {
      await reservation
      return {
        ownerId: activeLease.ownerId,
        mutationId,
        feature: 'create-client' as const,
        decision: { allowed: true } as const,
      }
    })
    const repository = new AdmissionControlledFieldCraftRepository({
      databaseName: 'feature-admission-order.test.db',
      entitlementStore: store,
      gateway: { reserve },
    })
    jest.spyOn(repository, 'list').mockResolvedValue(Array.from({ length: 10 }, () => ({})))
    const localWrite = jest
      .spyOn(SQLiteFieldCraftRepository.prototype, 'transactLocalMutation')
      .mockResolvedValue()
    const mutation: MutationEnvelope = {
      id: mutationId,
      ownerId: activeLease.ownerId,
      entity: 'client',
      entityId: '80000000-0000-4000-8000-000000000002',
      kind: 'create',
      baseVersion: null,
      payload: { id: '80000000-0000-4000-8000-000000000002' },
      createdAt: '2026-08-09T00:00:00.000Z',
      attempts: 0,
    }

    const pending = repository.transactLocalMutation(mutation)
    await Promise.resolve()
    expect(localWrite).not.toHaveBeenCalled()
    release()
    await pending
    expect(reserve).toHaveBeenCalledWith(activeLease, mutationId, 'create-client')
    expect(localWrite).toHaveBeenCalledTimes(1)
    localWrite.mockRestore()
  })
})
