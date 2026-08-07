import { act, render, screen, waitFor } from '@testing-library/react-native'
import { Text } from 'react-native'

import type { AuthenticatedOwnerLease } from '../src/auth/AuthProvider'
import { validateEntityPayload } from '../src/data/sqliteRepository'
import { createSupabaseGateway } from '../src/data/supabaseGateway'
import {
  OnboardingProfileV1Schema,
  type OnboardingProfileV1,
  type UserProfile,
} from '../src/domain/entities'
import {
  createOnboardingMutation,
  createOnboardingSaver,
} from '../src/features/onboarding/saveOnboarding'
import { OnboardingGate } from '../src/features/onboarding/OnboardingGate'

const OWNER = '123e4567-e89b-12d3-a456-426614174000'
const MUTATION = '323e4567-e89b-42d3-a456-426614174000'
const NOW = '2026-08-07T18:00:00.000Z'

const profile: OnboardingProfileV1 = {
  displayName: 'Avi Builder',
  businessName: 'FieldCraft Plumbing',
  tradeType: 'Plumbing',
  hourlyRateCents: 12_550,
  taxBasisPoints: 875,
  paymentTerms: 'Net 30',
  countryCode: 'US',
  currency: 'USD',
  timeZone: 'America/Los_Angeles',
  onboardingVersion: 1,
  onboardingCompletedAt: NOW,
}

const lease: AuthenticatedOwnerLease = Object.freeze({
  ownerId: OWNER,
  sessionGeneration: 7,
  repositoryRevision: 4,
})

const persistedProfile = (overrides: Partial<UserProfile> = {}): UserProfile => ({
  id: OWNER,
  ownerId: OWNER,
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
  syncState: 'current',
  ...profile,
  ...overrides,
})

const unsyncableOnboardingCases: ReadonlyArray<readonly [
  string,
  (value: Record<string, unknown>) => Record<string, unknown>,
]> = [
  ['NUL between valid astral pairs', (value) => ({
    ...value,
    displayName: '😀\u0000😀',
  })],
  ['lone high surrogate at a text boundary', (value) => ({
    ...value,
    businessName: 'FieldCraft Plumbing\uD800',
  })],
  ['lone low surrogate at a text boundary', (value) => ({
    ...value,
    timeZone: '\uDC00America/Los_Angeles',
  })],
]

const corruptOnboardingCases: ReadonlyArray<readonly [
  string,
  (value: Record<string, unknown>) => Record<string, unknown>,
]> = [
  ...unsyncableOnboardingCases,
  ['leading display-name whitespace', (value) => ({ ...value, displayName: ' Avi Builder' })],
  ['leading display-name tab', (value) => ({ ...value, displayName: '\tAvi Builder' })],
  ['leading display-name next-line whitespace', (value) => ({ ...value, displayName: '\u0085Avi Builder' })],
  ['trailing display-name byte-order-mark whitespace', (value) => ({
    ...value,
    displayName: 'Avi Builder\uFEFF',
  })],
  ['trailing business-name whitespace', (value) => ({ ...value, businessName: 'FieldCraft ' })],
  ['trailing business-name newline', (value) => ({
    ...value,
    businessName: 'FieldCraft Plumbing\n',
  })],
  ['oversized astral display name', (value) => ({ ...value, displayName: '😀'.repeat(101) })],
  ['oversized astral business name', (value) => ({ ...value, businessName: '😀'.repeat(121) })],
  ['unknown trade', (value) => ({ ...value, tradeType: 'Software' })],
  ['zero hourly rate', (value) => ({ ...value, hourlyRateCents: 0 })],
  ['excess hourly rate', (value) => ({ ...value, hourlyRateCents: 100_000_001 })],
  ['fractional tax', (value) => ({ ...value, taxBasisPoints: 1.5 })],
  ['excess tax', (value) => ({ ...value, taxBasisPoints: 10_001 })],
  ['unknown payment terms', (value) => ({ ...value, paymentTerms: 'Net 60' })],
  ['unknown country', (value) => ({ ...value, countryCode: 'CA' })],
  ['unknown currency', (value) => ({ ...value, currency: 'CAD' })],
  ['leading timezone whitespace', (value) => ({ ...value, timeZone: ' America/Los_Angeles' })],
  ['leading timezone nonbreaking space', (value) => ({
    ...value,
    timeZone: '\u00A0America/Los_Angeles',
  })],
  ['oversized timezone', (value) => ({ ...value, timeZone: 'A'.repeat(101) })],
  ['oversized astral timezone', (value) => ({ ...value, timeZone: '😀'.repeat(101) })],
  ['noncanonical completion timestamp', (value) => ({
    ...value,
    onboardingCompletedAt: '2026-08-07T11:00:00-07:00',
  })],
  ['completion timestamp without milliseconds', (value) => ({
    ...value,
    onboardingCompletedAt: '2026-08-07T18:00:00Z',
  })],
  ['completion timestamp with year zero', (value) => ({
    ...value,
    onboardingCompletedAt: '0000-01-01T00:00:00.000Z',
  })],
  ['completion timestamp with an impossible date', (value) => ({
    ...value,
    onboardingCompletedAt: '2026-02-31T18:00:00.000Z',
  })],
  ['unexpected profile key', (value) => ({ ...value, administrator: true })],
]

it('reuses the exact mutation ID and content after an ambiguous onboarding save', async () => {
  const writes: unknown[] = []
  let attempt = 0
  const repository = {
    transactLocalMutation: jest.fn(async (mutation) => {
      writes.push(mutation)
      attempt += 1
      if (attempt === 1) throw new Error('ambiguous SQLite completion')
    }),
  }
  const saver = createOnboardingSaver({
    lease,
    repository,
    createMutationId: () => MUTATION,
    now: () => NOW,
  })

  await expect(saver.save(profile)).rejects.toThrow('Unable to save your profile securely.')
  await expect(saver.save(profile)).resolves.toBeUndefined()

  expect(writes).toHaveLength(2)
  expect(writes[0]).toEqual(writes[1])
  expect(writes[0]).toEqual(createOnboardingMutation({
    lease,
    mutationId: MUTATION,
    now: NOW,
    profile,
  }))
  expect((writes[0] as { payload: UserProfile }).payload).toMatchObject({
    id: OWNER,
    ownerId: OWNER,
    ...profile,
  })
})

it('rejects a mismatched or noncanonical onboarding owner before local persistence', () => {
  expect(() => createOnboardingMutation({
    lease: { ...lease, ownerId: 'not-a-uuid' },
    mutationId: MUTATION,
    now: NOW,
    profile,
  })).toThrow('authenticated owner')
  expect(() => createOnboardingMutation({
    lease,
    mutationId: MUTATION,
    now: 'not-a-timestamp',
    profile,
  })).toThrow('timestamp')
})

it.each(corruptOnboardingCases)(
  'rejects %s through the reusable create and SQLite profile contract',
  (_label, corrupt) => {
    const corruptInput = corrupt({ ...profile })
    expect(() => OnboardingProfileV1Schema.parse(corruptInput)).toThrow()
    expect(() => createOnboardingMutation({
      lease,
      mutationId: MUTATION,
      now: String(corruptInput.onboardingCompletedAt ?? NOW),
      profile: corruptInput as OnboardingProfileV1,
    })).toThrow()
    expect(() => validateEntityPayload(
      'profile',
      corrupt(persistedProfile() as unknown as Record<string, unknown>),
      OWNER,
      OWNER,
    )).toThrow()
  },
)

it.each(unsyncableOnboardingCases)(
  'rejects %s before onboarding can persist a local profile or outbox mutation',
  (_label, corrupt) => {
    const repository = { transactLocalMutation: jest.fn(async () => undefined) }
    const saver = createOnboardingSaver({
      lease,
      repository,
      createMutationId: () => MUTATION,
    })

    expect(() => saver.save(corrupt({ ...profile }) as OnboardingProfileV1)).toThrow()
    expect(repository.transactLocalMutation).not.toHaveBeenCalled()
  },
)

it.each([
  ['minimum supported year', '0001-01-01T00:00:00.000Z'],
  ['maximum supported year', '9999-12-31T23:59:59.999Z'],
] as const)(
  'accepts Unicode code-point maxima and the %s timestamp endpoint',
  (_label, timestamp) => {
    const boundaryProfile: OnboardingProfileV1 = {
      ...profile,
      displayName: '😀'.repeat(100),
      businessName: '😀'.repeat(120),
      timeZone: '😀'.repeat(100),
      onboardingCompletedAt: timestamp,
    }
    expect(OnboardingProfileV1Schema.parse(boundaryProfile)).toEqual(boundaryProfile)
    const mutation = createOnboardingMutation({
      lease,
      mutationId: MUTATION,
      now: timestamp,
      profile: boundaryProfile,
    })
    expect(() => validateEntityPayload(
      'profile',
      mutation.payload,
      OWNER,
      OWNER,
    )).not.toThrow()
  },
)

it('preserves valid paired astral text through onboarding persistence', async () => {
  const repository = { transactLocalMutation: jest.fn(async () => undefined) }
  const saver = createOnboardingSaver({
    lease,
    repository,
    createMutationId: () => MUTATION,
  })
  const astralProfile: OnboardingProfileV1 = {
    ...profile,
    displayName: `😀${'A'.repeat(98)}😀`,
    businessName: `😀${'B'.repeat(118)}😀`,
    timeZone: `😀${'T'.repeat(98)}😀`,
  }

  await expect(saver.save(astralProfile)).resolves.toBeUndefined()
  expect(repository.transactLocalMutation).toHaveBeenCalledWith(
    expect.objectContaining({ payload: expect.objectContaining(astralProfile) }),
  )
})

it('uses the reviewed completion timestamp instead of rereading a drifting clock during save', async () => {
  const repository = { transactLocalMutation: jest.fn(async () => undefined) }
  const saver = createOnboardingSaver({
    lease,
    repository,
    createMutationId: () => MUTATION,
    now: () => '2026-08-07T18:00:00.001Z',
  })

  await expect(saver.save(profile)).resolves.toBeUndefined()
  expect(repository.transactLocalMutation).toHaveBeenCalledWith(
    expect.objectContaining({ createdAt: profile.onboardingCompletedAt }),
  )
})

it('restores a complete persisted profile and redirects missing onboarding without stale-owner reads', async () => {
  const repository = { get: jest.fn(async () => persistedProfile()) }
  const first = render(
    <OnboardingGate
      lease={lease}
      repository={repository}
      repositoryOwnerId={OWNER}
      replace={jest.fn()}
    >
      <Text>Dashboard</Text>
    </OnboardingGate>,
  )
  expect(await screen.findByText('Dashboard')).toBeTruthy()
  first.unmount()

  const missingView = render(
    <OnboardingGate
      lease={lease}
      repository={repository}
      repositoryOwnerId={OWNER}
      replace={jest.fn()}
    >
      <Text>Dashboard</Text>
    </OnboardingGate>,
  )
  expect(await screen.findByText('Dashboard')).toBeTruthy()

  const replace = jest.fn()
  const missingRepository = { get: jest.fn(async () => null) }
  render(
    <OnboardingGate
      lease={lease}
      repository={missingRepository}
      repositoryOwnerId={OWNER}
      replace={replace}
    >
      <Text>Protected job</Text>
    </OnboardingGate>,
  )
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/(auth)/onboarding'))
  expect(screen.queryByText('Protected job')).toBeNull()
  expect(screen.getByText('Opening secure setup…')).toBeTruthy()
  missingView.unmount()

  const incompleteReplace = jest.fn()
  render(
    <OnboardingGate
      lease={lease}
      repository={{
        get: jest.fn(async () => ({
          id: OWNER,
          ownerId: OWNER,
          businessName: 'Legacy business',
          version: 1,
          createdAt: NOW,
          updatedAt: NOW,
          syncState: 'current',
        })),
      }}
      repositoryOwnerId={OWNER}
      replace={incompleteReplace}
    >
      <Text>Protected invoice</Text>
    </OnboardingGate>,
  )
  await waitFor(() => expect(incompleteReplace).toHaveBeenCalledWith('/(auth)/onboarding'))
  expect(screen.queryByText('Protected invoice')).toBeNull()
})

it('renders a visible local-data error and discards a stale owner result', async () => {
  let resolveFirst!: (value: UserProfile) => void
  const staleRead = new Promise<UserProfile>((resolve) => { resolveFirst = resolve })
  const repository = {
    get: jest.fn()
      .mockResolvedValueOnce(persistedProfile())
      .mockImplementationOnce(async () => staleRead),
  }
  const view = render(
    <OnboardingGate
      lease={lease}
      repository={repository}
      repositoryOwnerId={OWNER}
      replace={jest.fn()}
    >
      <Text>Old owner dashboard</Text>
    </OnboardingGate>,
  )
  expect(await screen.findByText('Old owner dashboard')).toBeTruthy()
  view.rerender(
    <OnboardingGate
      lease={{ ...lease, ownerId: '223e4567-e89b-12d3-a456-426614174000' }}
      repository={repository}
      repositoryOwnerId="223e4567-e89b-12d3-a456-426614174000"
      replace={jest.fn()}
    >
      <Text>New owner dashboard</Text>
    </OnboardingGate>,
  )
  expect(screen.queryByText('Old owner dashboard')).toBeNull()
  expect(screen.queryByText('New owner dashboard')).toBeNull()
  await act(async () => resolveFirst(persistedProfile()))
  expect(screen.queryByText('Old owner dashboard')).toBeNull()

  view.rerender(
    <OnboardingGate
      lease={lease}
      repository={{ get: jest.fn(async () => { throw new Error('corrupt payload secret') }) }}
      repositoryOwnerId={OWNER}
      replace={jest.fn()}
    >
      <Text>Protected job</Text>
    </OnboardingGate>,
  )
  expect((await screen.findByRole('alert')).props.children[0]).toBe(
    'Local data could not be prepared securely.',
  )
  expect(screen.queryByText('Protected job')).toBeNull()
})

it.each(corruptOnboardingCases)(
  'fails the onboarding gate closed for %s',
  async (_label, corrupt) => {
    render(
      <OnboardingGate
        lease={lease}
        repository={{
          get: jest.fn(async () => corrupt(
            persistedProfile() as unknown as Record<string, unknown>,
          )),
        }}
        repositoryOwnerId={OWNER}
        replace={jest.fn()}
      >
        <Text>Protected dashboard</Text>
      </OnboardingGate>,
    )

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText('Protected dashboard')).toBeNull()
  },
)

type Reply = { data: unknown; error: unknown | null; status: number }
class Client {
  readonly calls: { name: string; parameters: Record<string, unknown> }[] = []
  replies: Reply[] = []
  rpc(name: string, parameters: Record<string, unknown>): PromiseLike<Reply> {
    this.calls.push({ name, parameters })
    return Promise.resolve(this.replies.shift()!)
  }
  channel() {
    return { on() { return this }, subscribe() { return this }, unsubscribe() {} }
  }
}

const rawProfile = (
  source: Record<string, unknown> = profile as unknown as Record<string, unknown>,
) => ({
  id: OWNER,
  display_name: source.displayName,
  business_name: source.businessName,
  trade_type: source.tradeType,
  hourly_rate_cents: source.hourlyRateCents,
  tax_basis_points: source.taxBasisPoints,
  payment_terms: source.paymentTerms,
  country_code: source.countryCode,
  currency: source.currency,
  time_zone: source.timeZone,
  onboarding_version: source.onboardingVersion,
  onboarding_completed_at: source.onboardingCompletedAt,
  version: 1,
  created_at: NOW,
  updated_at: NOW,
})

it.each(corruptOnboardingCases.filter(([label]) => ![
  'unexpected profile key',
  'noncanonical completion timestamp',
  'completion timestamp without milliseconds',
].includes(label)))(
  'rejects %s from cloud onboarding normalization',
  async (_label, corrupt) => {
    const client = new Client()
    const mutation = createOnboardingMutation({ lease, mutationId: MUTATION, now: NOW, profile })
    client.replies = [{
      data: {
        status: 'applied',
        mutation_id: MUTATION,
        entity: 'profile',
        kind: 'create',
        entity_id: OWNER,
        cloud: rawProfile(corrupt({ ...profile })),
        sync_position: {
          updated_at: NOW,
          change_seq: 1,
          change_id: 1,
          source: 'sync_changes',
        },
      },
      error: null,
      status: 200,
    }]

    await expect(createSupabaseGateway(client).pushMutation(
      OWNER,
      mutation,
      new AbortController().signal,
    )).rejects.toMatchObject({ reason: 'invalid-response' })
  },
)

it('round-trips every onboarding field through push receipt replay and pull normalization', async () => {
  const client = new Client()
  const mutation = createOnboardingMutation({ lease, mutationId: MUTATION, now: NOW, profile })
  const postgresProfile = {
    ...rawProfile(),
    onboarding_completed_at: '2026-08-07T18:00:00+00:00',
  }
  const applied = {
    status: 'applied',
    mutation_id: MUTATION,
    entity: 'profile',
    kind: 'create',
    entity_id: OWNER,
    cloud: postgresProfile,
    sync_position: {
      updated_at: NOW,
      change_seq: 1,
      change_id: 1,
      source: 'sync_changes',
    },
  }
  client.replies = [
    { data: applied, error: null, status: 200 },
    { data: applied, error: null, status: 200 },
    {
      data: {
        status: 'ok',
        changes: [{
          change_seq: 1,
          change_id: 1,
          owner_id: OWNER,
          entity: 'profile',
          entity_id: OWNER,
          version: 1,
          updated_at: NOW,
          deleted: false,
          payload: postgresProfile,
        }],
        cursor: { updated_at: NOW, change_seq: 1, change_id: 1 },
        has_more: false,
      },
      error: null,
      status: 200,
    },
  ]
  const gateway = createSupabaseGateway(client)

  const first = await gateway.pushMutation(OWNER, mutation, new AbortController().signal)
  const replay = await gateway.pushMutation(OWNER, mutation, new AbortController().signal)
  const pulled = await gateway.pullSince(OWNER, null, new AbortController().signal)

  expect(first).toEqual(replay)
  expect(first.type).toBe('applied')
  expect(first.type === 'applied' ? first.rows[0].payload : null).toEqual(persistedProfile())
  expect(pulled.rows[0].payload).toEqual(persistedProfile())
  expect(client.calls.slice(0, 2)).toEqual([
    { name: 'save_fieldcraft_onboarding', parameters: { p_mutation_id: MUTATION, p_payload: mutation.payload } },
    { name: 'save_fieldcraft_onboarding', parameters: { p_mutation_id: MUTATION, p_payload: mutation.payload } },
  ])
})
