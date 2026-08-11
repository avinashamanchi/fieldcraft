import * as SecureStore from 'expo-secure-store'

import { getSupabaseClient } from './supabase'

const PENDING_ENROLLMENT_KEY = 'fieldcraft.pending-mfa-enrollment.v1'
const FACTOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/

type ProviderReply<T> = PromiseLike<{ data: T; error: unknown | null }>
type MfaClient = {
  auth: {
    mfa: {
      enroll(options: { factorType: 'totp'; friendlyName: string }): ProviderReply<{
        id: string
        totp?: { qr_code?: string; secret?: string; uri?: string }
      }>
      challenge(options: { factorId: string }): ProviderReply<{ id: string }>
      verify(options: {
        factorId: string
        challengeId: string
        code: string
      }): ProviderReply<unknown>
      listFactors(): ProviderReply<{
        totp?: { id: string; status?: string; friendly_name?: string }[]
      }>
      unenroll(options: { factorId: string }): ProviderReply<unknown>
    }
  }
}

export interface MfaService {
  enrollTotp(): Promise<{
    factorId: string
    qrCodeDataUri: string
    secret: string
    uri: string
  }>
  verifyEnrollment(factorId: string, code: string): Promise<void>
  stepUp(factorId: string, code: string): Promise<void>
  listVerifiedTotp(): Promise<{ id: string; friendlyName?: string }[]>
  cleanupUnverifiedTotp(factorId?: string): Promise<void>
  unenroll(factorId: string): Promise<void>
}

export interface PendingMfaEnrollmentStore {
  get(): Promise<string | null>
  set(factorId: string): Promise<void>
  clear(factorId: string): Promise<void>
}

export class MfaOperationError extends Error {
  constructor(readonly code: 'INVALID_TOTP_CODE' | 'MFA_UNAVAILABLE') {
    super(code === 'INVALID_TOTP_CODE'
      ? 'Enter the six-digit code from your authenticator.'
      : 'Authenticator verification is temporarily unavailable.')
    this.name = 'MfaOperationError'
  }
}

const requireCode = (code: string): string => {
  if (!/^\d{6}$/.test(code)) throw new MfaOperationError('INVALID_TOTP_CODE')
  return code
}

const requireFactorId = (factorId: string): string => {
  if (!FACTOR_ID_PATTERN.test(factorId)) throw new MfaOperationError('MFA_UNAVAILABLE')
  return factorId
}

const secureStoreQueues = new WeakMap<object, Promise<void>>()
const serializeSecureStore = <T>(work: () => Promise<T>): Promise<T> => {
  const previous = secureStoreQueues.get(SecureStore) ?? Promise.resolve()
  const current = previous.then(work, work)
  const settled = current.then(() => undefined, () => undefined)
  secureStoreQueues.set(SecureStore, settled)
  void settled.finally(() => {
    if (secureStoreQueues.get(SecureStore) === settled) secureStoreQueues.delete(SecureStore)
  })
  return current
}

const pendingMfaEnrollmentStore: PendingMfaEnrollmentStore = {
  get: () => serializeSecureStore(async () => {
    try {
      const factorId = await SecureStore.getItemAsync(PENDING_ENROLLMENT_KEY)
      return factorId === null ? null : requireFactorId(factorId)
    } catch {
      throw new MfaOperationError('MFA_UNAVAILABLE')
    }
  }),
  set: (factorId) => serializeSecureStore(async () => {
    try {
      await SecureStore.setItemAsync(PENDING_ENROLLMENT_KEY, requireFactorId(factorId))
    } catch {
      throw new MfaOperationError('MFA_UNAVAILABLE')
    }
  }),
  clear: (factorId) => serializeSecureStore(async () => {
    try {
      const safeFactorId = requireFactorId(factorId)
      const current = await SecureStore.getItemAsync(PENDING_ENROLLMENT_KEY)
      if (current === safeFactorId) await SecureStore.deleteItemAsync(PENDING_ENROLLMENT_KEY)
    } catch {
      throw new MfaOperationError('MFA_UNAVAILABLE')
    }
  }),
}

const requireEnrollment = (data: {
  id: string
  totp?: { qr_code?: string; secret?: string; uri?: string }
}) => {
  const factorId = requireFactorId(data.id)
  const qrCodeDataUri = data.totp?.qr_code ?? ''
  const secret = data.totp?.secret ?? ''
  const uri = data.totp?.uri ?? ''
  if (
    qrCodeDataUri.length > 100_000 ||
    (!qrCodeDataUri.startsWith('data:image/svg+xml') &&
      !qrCodeDataUri.startsWith('data:image/png;base64,')) ||
    !/^[A-Z2-7]+=*$/.test(secret) ||
    secret.length > 512 ||
    !uri.startsWith('otpauth://totp/') ||
    uri.length > 4_096
  ) {
    throw new MfaOperationError('MFA_UNAVAILABLE')
  }
  return { factorId, qrCodeDataUri, secret, uri }
}

const callProvider = async <T>(operation: () => ProviderReply<T>): Promise<T> => {
  try {
    const { data, error } = await operation()
    if (error) throw error
    return data
  } catch {
    throw new MfaOperationError('MFA_UNAVAILABLE')
  }
}

export const createMfaService = (
  suppliedClient?: MfaClient,
  pendingEnrollmentStore: PendingMfaEnrollmentStore = pendingMfaEnrollmentStore,
): MfaService => {
  const client = suppliedClient ?? getSupabaseClient() as unknown as MfaClient
  const challengeAndVerify = async (factorId: string, code: string): Promise<void> => {
    const safeFactorId = requireFactorId(factorId)
    const safeCode = requireCode(code)
    const challenge = await callProvider(() => client.auth.mfa.challenge({ factorId: safeFactorId }))
    if (!challenge.id) throw new MfaOperationError('MFA_UNAVAILABLE')
    await callProvider(() => client.auth.mfa.verify({
      factorId: safeFactorId,
      challengeId: challenge.id,
      code: safeCode,
    }))
  }

  return {
    async enrollTotp() {
      const data = await callProvider(() => client.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'FieldCraft authenticator',
      }))
      const enrollment = requireEnrollment(data)
      try {
        await pendingEnrollmentStore.set(enrollment.factorId)
      } catch {
        try {
          await callProvider(() => client.auth.mfa.unenroll({ factorId: enrollment.factorId }))
        } catch {
          try {
            await pendingEnrollmentStore.set(enrollment.factorId)
          } catch {
            // The provider cleanup and durable fallback both failed; remain fail-closed.
          }
        }
        throw new MfaOperationError('MFA_UNAVAILABLE')
      }
      return enrollment
    },
    async verifyEnrollment(factorId, code) {
      const safeFactorId = requireFactorId(factorId)
      await challengeAndVerify(safeFactorId, code)
      try {
        await pendingEnrollmentStore.clear(safeFactorId)
      } catch {
        // The factor is verified. Retaining the marker makes the next cleanup retry safe.
      }
    },
    stepUp: challengeAndVerify,
    async listVerifiedTotp() {
      const data = await callProvider(() => client.auth.mfa.listFactors())
      return (data.totp ?? [])
        .filter((factor) => factor.status === 'verified')
        .map((factor) => ({
          id: factor.id,
          ...(factor.friendly_name ? { friendlyName: factor.friendly_name } : {}),
        }))
    },
    async cleanupUnverifiedTotp(factorId) {
      const safeFactorId = factorId
        ? requireFactorId(factorId)
        : await pendingEnrollmentStore.get()
      if (!safeFactorId) return
      const data = await callProvider(() => client.auth.mfa.listFactors())
      const abandoned = (data.totp ?? []).find((factor) => factor.id === safeFactorId)
      if (abandoned?.status === 'unverified') {
        await callProvider(() => client.auth.mfa.unenroll({
          factorId: requireFactorId(abandoned.id),
        }))
      }
      await pendingEnrollmentStore.clear(safeFactorId)
    },
    async unenroll(factorId) {
      await callProvider(() => client.auth.mfa.unenroll({ factorId: requireFactorId(factorId) }))
    },
  }
}
