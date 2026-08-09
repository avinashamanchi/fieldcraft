import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import type { AuthenticatedOwnerLease } from '../src/auth/AuthProvider'
import { createMfaService } from '../src/auth/mfaService'
import { createRecentAal2Guard } from '../src/auth/requireAal2'
import MfaScreen from '../app/security/mfa'

const mockVerifyMfaChallenge = jest.fn(async (challenge: () => Promise<void>) => challenge())

jest.mock('../src/auth/AuthProvider', () => ({
  useAuthenticatedOwnerLease: () => Object.freeze({
    ownerId: '123e4567-e89b-12d3-a456-426614174000',
    sessionGeneration: 7,
    repositoryRevision: 4,
  }),
  useAuthActions: () => ({ verifyMfaChallenge: mockVerifyMfaChallenge }),
}))

const OWNER = '123e4567-e89b-12d3-a456-426614174000'
const lease = (sessionGeneration: number): AuthenticatedOwnerLease => Object.freeze({
  ownerId: OWNER,
  sessionGeneration,
  repositoryRevision: 4,
})
const emptyPendingEnrollmentStore = () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  clear: jest.fn().mockResolvedValue(undefined),
})

it('uses Supabase TOTP enrollment and challenge-and-verify without exposing provider errors', async () => {
  const enroll = jest.fn().mockResolvedValue({
    data: {
      id: 'factor-1',
      totp: {
        qr_code: 'data:image/svg+xml;utf8,%3Csvg%3E%3C/svg%3E',
        secret: 'JBSWY3DPEHPK3PXP',
        uri: 'otpauth://totp/FieldCraft?secret=JBSWY3DPEHPK3PXP',
      },
    },
    error: null,
  })
  const challenge = jest.fn().mockResolvedValue({ data: { id: 'challenge-1' }, error: null })
  const verify = jest.fn().mockResolvedValue({ data: {}, error: null })
  const listFactors = jest.fn().mockResolvedValue({
    data: { totp: [{ id: 'factor-1', status: 'verified', friendly_name: 'iPhone' }] },
    error: null,
  })
  const unenroll = jest.fn().mockResolvedValue({ data: {}, error: null })
  const pendingEnrollmentStore = emptyPendingEnrollmentStore()
  const service = createMfaService(
    { auth: { mfa: { enroll, challenge, verify, listFactors, unenroll } } },
    pendingEnrollmentStore,
  )

  await expect(service.enrollTotp()).resolves.toEqual({
    factorId: 'factor-1',
    qrCodeDataUri: 'data:image/svg+xml;utf8,%3Csvg%3E%3C/svg%3E',
    secret: 'JBSWY3DPEHPK3PXP',
    uri: 'otpauth://totp/FieldCraft?secret=JBSWY3DPEHPK3PXP',
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
  expect(pendingEnrollmentStore.set).toHaveBeenCalledWith('factor-1')
  expect(pendingEnrollmentStore.clear).toHaveBeenCalledWith('factor-1')
})

it('removes only abandoned unverified TOTP factors', async () => {
  const unenroll = jest.fn().mockResolvedValue({ data: {}, error: null })
  const pendingEnrollmentStore = {
    get: jest.fn().mockResolvedValue('abandoned-factor'),
    set: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  }
  const service = createMfaService(
    {
      auth: {
        mfa: {
          enroll: jest.fn(),
          challenge: jest.fn(),
          verify: jest.fn(),
          listFactors: jest.fn().mockResolvedValue({
            data: {
              totp: [
                { id: 'verified-factor', status: 'verified' },
                { id: 'abandoned-factor', status: 'unverified' },
                { id: 'other-device-factor', status: 'unverified' },
              ],
            },
            error: null,
          }),
          unenroll,
        },
      },
    },
    pendingEnrollmentStore,
  )

  await service.cleanupUnverifiedTotp()

  expect(unenroll).toHaveBeenCalledTimes(1)
  expect(unenroll).toHaveBeenCalledWith({ factorId: 'abandoned-factor' })
  expect(pendingEnrollmentStore.clear).toHaveBeenCalledWith('abandoned-factor')
})

it('removes a newly created factor if its durable pending marker cannot be written', async () => {
  const unenroll = jest.fn().mockResolvedValue({ data: {}, error: null })
  const pendingEnrollmentStore = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockRejectedValue(new Error('secure store unavailable')),
    clear: jest.fn().mockResolvedValue(undefined),
  }
  const service = createMfaService(
    {
      auth: {
        mfa: {
          enroll: jest.fn().mockResolvedValue({
            data: {
              id: 'factor-new',
              totp: {
                qr_code: 'data:image/svg+xml;utf8,%3Csvg%3E%3C/svg%3E',
                secret: 'JBSWY3DPEHPK3PXP',
                uri: 'otpauth://totp/FieldCraft?secret=JBSWY3DPEHPK3PXP',
              },
            },
            error: null,
          }),
          challenge: jest.fn(),
          verify: jest.fn(),
          listFactors: jest.fn(),
          unenroll,
        },
      },
    },
    pendingEnrollmentStore,
  )

  await expect(service.enrollTotp()).rejects.toMatchObject({ code: 'MFA_UNAVAILABLE' })
  expect(unenroll).toHaveBeenCalledWith({ factorId: 'factor-new' })
})

it('renders a real QR image and exact selectable fallback while locking concurrent enrollment', async () => {
  let finishEnrollment!: (value: {
    factorId: string
    qrCodeDataUri: string
    secret: string
    uri: string
  }) => void
  const enrollment = new Promise<{
    factorId: string
    qrCodeDataUri: string
    secret: string
    uri: string
  }>((resolve) => { finishEnrollment = resolve })
  const cleanupUnverifiedTotp = jest.fn().mockResolvedValue(undefined)
  const service = {
    enrollTotp: jest.fn(async () => enrollment),
    cleanupUnverifiedTotp,
    listVerifiedTotp: jest.fn().mockResolvedValue([]),
    verifyEnrollment: jest.fn().mockResolvedValue(undefined),
    stepUp: jest.fn().mockResolvedValue(undefined),
    unenroll: jest.fn().mockResolvedValue(undefined),
  }
  const view = render(<MfaScreen service={service} />)
  await waitFor(() => expect(service.listVerifiedTotp).toHaveBeenCalled())

  fireEvent.press(screen.getByRole('button', { name: 'Add authenticator' }))
  fireEvent.press(screen.getByRole('button', { name: 'Adding authenticator…' }))
  await waitFor(() => expect(service.enrollTotp).toHaveBeenCalledTimes(1))

  await act(async () => finishEnrollment({
    factorId: 'factor-new',
    qrCodeDataUri: 'data:image/svg+xml;utf8,%3Csvg%3EQR%3C/svg%3E',
    secret: 'JBSWY3DPEHPK3PXP',
    uri: 'otpauth://totp/FieldCraft?secret=JBSWY3DPEHPK3PXP',
  }))

  const renderedQrSource = screen.getByLabelText('Authenticator QR code').props.source
  expect(Array.isArray(renderedQrSource) ? renderedQrSource[0] : renderedQrSource).toEqual({
    uri: 'data:image/svg+xml;utf8,%3Csvg%3EQR%3C/svg%3E',
  })
  expect(screen.getByText('JBSWY3DPEHPK3PXP').props.selectable).toBe(true)
  expect(screen.getByText('otpauth://totp/FieldCraft?secret=JBSWY3DPEHPK3PXP').props.selectable).toBe(true)

  view.unmount()
  await waitFor(() => expect(cleanupUnverifiedTotp).toHaveBeenCalledWith('factor-new'))
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
