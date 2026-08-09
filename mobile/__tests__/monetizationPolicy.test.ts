import appConfig from '../app.config'
import {
  FREE_LIMITS,
  evaluateFeature,
  type FeatureCounts,
  type ProEntitlement,
} from '../src/domain/monetization'

const counts = (overrides: Partial<FeatureCounts> = {}): FeatureCounts => ({
  clients: 0,
  openJobs: 0,
  issuedDocumentsPerRolling30Days: 0,
  ...overrides,
})

const entitlement = (state: ProEntitlement['state']): ProEntitlement => state === 'pro'
  ? { state, productId: 'fieldcraft_pro_monthly', expiresAt: '2026-09-01T00:00:00.000Z' }
  : { state }

describe('FieldCraft downgrade-safe monetization policy', () => {
  it.each([
    ['create-client', { clients: FREE_LIMITS.clients - 1 }],
    ['create-open-job', { openJobs: FREE_LIMITS.openJobs - 1 }],
    ['issue-document', { issuedDocumentsPerRolling30Days: FREE_LIMITS.issuedDocumentsPerRolling30Days - 1 }],
  ] as const)('allows %s below its free boundary without Pro', (feature, localCounts) => {
    expect(evaluateFeature(feature, entitlement('free'), counts(localCounts))).toEqual({ allowed: true })
  })

  it.each([
    ['create-client', { clients: FREE_LIMITS.clients }, FREE_LIMITS.clients],
    ['create-open-job', { openJobs: FREE_LIMITS.openJobs }, FREE_LIMITS.openJobs],
    ['issue-document', { issuedDocumentsPerRolling30Days: FREE_LIMITS.issuedDocumentsPerRolling30Days }, FREE_LIMITS.issuedDocumentsPerRolling30Days],
  ] as const)('denies %s at the free boundary with its exact limit', (feature, localCounts, limit) => {
    expect(evaluateFeature(feature, entitlement('free'), counts(localCounts))).toEqual({
      allowed: false,
      reason: 'FREE_LIMIT',
      limit,
    })
    expect(evaluateFeature(feature, entitlement('unknown'), counts(localCounts))).toEqual({
      allowed: false,
      reason: 'ENTITLEMENT_STALE',
    })
    expect(evaluateFeature(feature, entitlement('pro'), counts(localCounts))).toEqual({ allowed: true })
  })

  it.each(['stripe-payment-link', 'scheduled-reminder', 'revenue-dashboard'] as const)(
    'requires a verified Pro entitlement for %s',
    (feature) => {
      expect(evaluateFeature(feature, entitlement('free'), counts())).toEqual({
        allowed: false,
        reason: 'PRO_REQUIRED',
      })
      expect(evaluateFeature(feature, entitlement('unknown'), counts())).toEqual({
        allowed: false,
        reason: 'ENTITLEMENT_STALE',
      })
      expect(evaluateFeature(feature, entitlement('pro'), counts())).toEqual({ allowed: true })
    },
  )

  it.each([
    'edit-existing-record',
    'record-payment',
    'export-account',
    'delete-account',
  ] as const)('never blocks downgrade-safe feature %s', (feature) => {
    expect(evaluateFeature(feature, entitlement('unknown'), counts({
      clients: 50,
      openJobs: 50,
      issuedDocumentsPerRolling30Days: 50,
    }))).toEqual({ allowed: true })
  })
})

describe('FieldCraft production purchase configuration', () => {
  const originalProfile = process.env.EAS_BUILD_PROFILE
  const originalKey = process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY

  afterEach(() => {
    if (originalProfile === undefined) delete process.env.EAS_BUILD_PROFILE
    else process.env.EAS_BUILD_PROFILE = originalProfile
    if (originalKey === undefined) delete process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY
    else process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY = originalKey
  })

  it('fails a production build without a valid public RevenueCat iOS key', () => {
    process.env.EAS_BUILD_PROFILE = 'production'
    delete process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY
    expect(() => appConfig({ config: {} } as never)).toThrow('EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY')
    process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY = 'not-a-public-ios-key'
    expect(() => appConfig({ config: {} } as never)).toThrow('EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY')
  })

  it('accepts the public iOS key format without embedding any provider secret', () => {
    process.env.EAS_BUILD_PROFILE = 'production'
    process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY = 'appl_public_fieldcraft_example'
    expect(() => appConfig({ config: {} } as never)).not.toThrow()
  })
})
