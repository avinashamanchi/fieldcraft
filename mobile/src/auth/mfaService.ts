import { getSupabaseClient } from './supabase'

type ProviderReply<T> = PromiseLike<{ data: T; error: unknown | null }>
type MfaClient = {
  auth: {
    mfa: {
      enroll(options: { factorType: 'totp'; friendlyName: string }): ProviderReply<{
        id: string
        totp?: { qr_code?: string }
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
  enrollTotp(): Promise<{ factorId: string; qrCode: string }>
  verifyEnrollment(factorId: string, code: string): Promise<void>
  stepUp(factorId: string, code: string): Promise<void>
  listVerifiedTotp(): Promise<{ id: string; friendlyName?: string }[]>
  unenroll(factorId: string): Promise<void>
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
  if (!factorId || factorId.length > 200) throw new MfaOperationError('MFA_UNAVAILABLE')
  return factorId
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

export const createMfaService = (suppliedClient?: MfaClient): MfaService => {
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
      const qrCode = data.totp?.qr_code
      if (!data.id || !qrCode) throw new MfaOperationError('MFA_UNAVAILABLE')
      return { factorId: data.id, qrCode }
    },
    verifyEnrollment: challengeAndVerify,
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
    async unenroll(factorId) {
      await callProvider(() => client.auth.mfa.unenroll({ factorId: requireFactorId(factorId) }))
    },
  }
}
