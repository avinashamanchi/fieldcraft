import type { AuthenticatedOwnerLease } from '../src/auth/AuthProvider'
import { createMfaService } from '../src/auth/mfaService'
import { createRecentAal2Guard } from '../src/auth/requireAal2'

const OWNER = '123e4567-e89b-12d3-a456-426614174000'
const lease = (sessionGeneration: number): AuthenticatedOwnerLease => Object.freeze({
  ownerId: OWNER,
  sessionGeneration,
  repositoryRevision: 4,
})

it('uses Supabase TOTP enrollment and challenge-and-verify without exposing provider errors', async () => {
  const enroll = jest.fn().mockResolvedValue({
    data: { id: 'factor-1', totp: { qr_code: 'otpauth://totp/FieldCraft' } },
    error: null,
  })
  const challenge = jest.fn().mockResolvedValue({ data: { id: 'challenge-1' }, error: null })
  const verify = jest.fn().mockResolvedValue({ data: {}, error: null })
  const listFactors = jest.fn().mockResolvedValue({
    data: { totp: [{ id: 'factor-1', status: 'verified', friendly_name: 'iPhone' }] },
    error: null,
  })
  const unenroll = jest.fn().mockResolvedValue({ data: {}, error: null })
  const service = createMfaService({ auth: { mfa: { enroll, challenge, verify, listFactors, unenroll } } })

  await expect(service.enrollTotp()).resolves.toEqual({
    factorId: 'factor-1',
    qrCode: 'otpauth://totp/FieldCraft',
  })
  await service.verifyEnrollment('factor-1', '123456')
  await service.stepUp('factor-1', '654321')
  await expect(service.listVerifiedTotp()).resolves.toEqual([{ id: 'factor-1', friendlyName: 'iPhone' }])
  await service.unenroll('factor-1')

  expect(enroll).toHaveBeenCalledWith({ factorType: 'totp', friendlyName: 'FieldCraft authenticator' })
  expect(challenge.mock.calls).toEqual([
    [{ factorId: 'factor-1' }],
    [{ factorId: 'factor-1' }],
  ])
  expect(verify.mock.calls).toEqual([
    [{ factorId: 'factor-1', challengeId: 'challenge-1', code: '123456' }],
    [{ factorId: 'factor-1', challengeId: 'challenge-1', code: '654321' }],
  ])
  expect(unenroll).toHaveBeenCalledWith({ factorId: 'factor-1' })
})

it('marks recent AAL2 only for the current immutable owner lease and expires after 15 minutes', () => {
  const guard = createRecentAal2Guard()
  const firstLease = lease(7)
  guard.updateLease(firstLease)

  expect(() => guard.requireRecentAal2('stripe-connect', 1_000)).toThrow(
    expect.objectContaining({ code: 'STEP_UP_REQUIRED' }),
  )
  guard.markVerified({
    ownerId: OWNER,
    sessionGeneration: 7,
    repositoryRevision: 4,
    verifiedAt: 1_000,
  })
  expect(guard.requireRecentAal2('payment-link', 1_000 + 15 * 60_000)).toEqual(firstLease)
  expect(() => guard.requireRecentAal2('payment-adjustment', 1_000 + 15 * 60_000 + 1)).toThrow(
    expect.objectContaining({ code: 'STEP_UP_REQUIRED' }),
  )

  guard.markVerified({ ...firstLease, verifiedAt: 2_000 })
  guard.updateLease(lease(8))
  expect(() => guard.requireRecentAal2('account-export', 2_001)).toThrow(
    expect.objectContaining({ code: 'STEP_UP_REQUIRED' }),
  )
  guard.clear()
  expect(() => guard.requireRecentAal2('delete-account', 2_002)).toThrow(
    expect.objectContaining({ code: 'STEP_UP_REQUIRED' }),
  )
})

it('rejects malformed TOTP codes before contacting Supabase', async () => {
  const challenge = jest.fn()
  const service = createMfaService({
    auth: {
      mfa: {
        enroll: jest.fn(),
        challenge,
        verify: jest.fn(),
        listFactors: jest.fn(),
        unenroll: jest.fn(),
      },
    },
  })

  await expect(service.stepUp('factor-1', '12 3456')).rejects.toMatchObject({
    code: 'INVALID_TOTP_CODE',
  })
  expect(challenge).not.toHaveBeenCalled()
})
